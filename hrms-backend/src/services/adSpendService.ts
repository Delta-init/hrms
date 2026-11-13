import { Types } from "mongoose";
import { AdSpendWeek } from "../models/AdSpendWeek.js";
import { AdSpendSettings } from "../models/AdSpendSettings.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { Candidate } from "../models/Candidate.js";
import { Application } from "../models/Application.js";
import { Organization } from "../models/Organization.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { getOrgId } from "../utils/orgContext.js";
import { todayInTz, zonedTimeToUtc } from "../utils/schedule.js";
import {
  addMonths, isMonday, lastCompletedWeek, lineTotal, missingWeeks, mondayOf, monthOfWeek,
  monthsBetween, platformKey, round2, sourceIsPlatform, tidyLines, weekEnd, weekRangeForMonths, weekTotal,
} from "../utils/adSpend.js";
import { notify } from "./notificationService.js";
import { putObject, deleteObject, attachmentKey, publicUrl } from "./uploadService.js";
import { documentExt } from "../middleware/upload.js";
import type { IAdPlatform } from "../types/index.js";
import type { SaveWeekInput, UpdateSettingsInput } from "../validations/adSpendValidation.js";

/**
 * The recruitment ad spend tracker: a week logged at a time by the recruiter,
 * read as months, platforms and roles by HR and management.
 */

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** Where the sheet this replaced advertised. HR can rename, add and retire them. */
export const DEFAULT_PLATFORMS: IAdPlatform[] = [
  { key: "linkedin", label: "LinkedIn", active: true },
  { key: "indeed", label: "Indeed", active: true },
  { key: "meta", label: "Meta", active: true },
];

/** Requisitions a spend can be put against: ones that were, or are, being recruited for. */
const RECRUITING = ["approved", "on_hold", "filled", "closed"];

const MAX_ATTACHMENTS = 10;

/**
 * Every read and write here is one organisation's. Unlike most modules a
 * Super Admin with no organisation picked cannot be served "all of them" —
 * weeks of two tenants would add up into a number that belongs to neither.
 */
function org(): Types.ObjectId {
  const id = getOrgId();
  if (!id) throw err("Pick an organisation first — ad spend is kept per organisation", 400);
  return new Types.ObjectId(id);
}

const fmtDay = (key: string, withYear = false) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
    .format(new Date(`${key}T00:00:00Z`));

/** "2–8 Nov 2026", or "27 Oct – 2 Nov 2026" across a month end. */
export function weekLabel(weekStart: string): string {
  const end = weekEnd(weekStart);
  if (weekStart.slice(0, 7) === end.slice(0, 7)) return `${Number(weekStart.slice(8))}–${fmtDay(end, true)}`;
  return `${fmtDay(weekStart)} – ${fmtDay(end, true)}`;
}

type Named = { _id: unknown; name?: string } | null | undefined;
const person = (u: unknown) => {
  const p = u as Named;
  return p && typeof p === "object" && "name" in p ? { _id: String(p._id), name: p.name ?? "" } : null;
};

export interface AdSpendSettingsView {
  currency: string;
  monthlyBudget: number;
  platforms: IAdPlatform[];
  trackingFrom: string | null;
  timeZone: string;
  /** False until somebody saves the settings — everything above is then the defaults. */
  saved: boolean;
  updatedAt: Date | null;
  updatedBy: { _id: string; name: string } | null;
  /** Today, the week under way and the last finished week, in the organisation's time zone. */
  today: string;
  currentWeek: string;
  lastWeek: string;
}

export class AdSpendService {
  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings(now = new Date()): Promise<AdSpendSettingsView> {
    const organization = org();
    const [doc, tenant] = await Promise.all([
      AdSpendSettings.findOne({ organization }).populate("updatedBy", "name").lean(),
      Organization.findById(organization).select("settings.currency settings.timeZone").lean(),
    ]);
    const timeZone = tenant?.settings?.timeZone || "Asia/Dubai";
    const today = todayInTz(timeZone, now);
    return {
      currency: doc?.currency || tenant?.settings?.currency || "AED",
      monthlyBudget: doc?.monthlyBudget ?? 0,
      platforms: doc?.platforms?.length ? doc.platforms.map((p) => ({ key: p.key, label: p.label, active: p.active !== false })) : DEFAULT_PLATFORMS,
      trackingFrom: doc?.trackingFrom ?? null,
      timeZone,
      saved: !!doc,
      updatedAt: doc?.updatedAt ?? null,
      updatedBy: person(doc?.updatedBy),
      today,
      currentWeek: mondayOf(today),
      lastWeek: lastCompletedWeek(today),
    };
  }

  /**
   * Change the platforms, the budget, the currency or when the log is owed from.
   *
   * A platform keeps its key for life — amounts are stored against it — so a
   * rename is only a new label. One taken off the list is retired rather than
   * deleted when any week has money against it, so old weeks still say where
   * that money went; one never used simply goes.
   */
  async updateSettings(input: UpdateSettingsInput, by: string) {
    const organization = org();
    const current = await this.getSettings();
    const $set: Record<string, unknown> = { updatedBy: by };
    if (input.currency !== undefined) $set.currency = input.currency;
    if (input.monthlyBudget !== undefined) $set.monthlyBudget = round2(input.monthlyBudget);
    if (input.trackingFrom !== undefined) $set.trackingFrom = input.trackingFrom;

    if (input.platforms) {
      const labels = new Set<string>();
      for (const p of input.platforms) {
        const l = p.label.trim().toLowerCase();
        if (labels.has(l)) throw err(`“${p.label}” is on the list twice`, 400);
        labels.add(l);
      }
      const known = new Map(current.platforms.map((p) => [p.key, p]));
      const taken = new Set(current.platforms.map((p) => p.key));
      const next: IAdPlatform[] = [];
      for (const p of input.platforms) {
        if (p.key && known.has(p.key)) {
          next.push({ key: p.key, label: p.label.trim(), active: p.active });
          continue;
        }
        let key = platformKey(p.label) || "platform";
        for (let n = 2; taken.has(key); n++) key = `${platformKey(p.label) || "platform"}-${n}`;
        taken.add(key);
        next.push({ key, label: p.label.trim(), active: p.active });
      }
      const kept = new Set(next.map((p) => p.key));
      for (const old of current.platforms) {
        if (kept.has(old.key)) continue;
        const used = await AdSpendWeek.exists({ organization, "lines.amounts.platform": old.key });
        if (used) next.push({ ...old, active: false });
      }
      if (!next.some((p) => p.active)) throw err("Keep at least one platform on the list", 400);
      $set.platforms = next;
    } else if (!current.saved) {
      // The first save writes the defaults down, so later renames have keys to hold on to.
      $set.platforms = current.platforms;
    }

    await AdSpendSettings.updateOne({ organization }, { $set, $setOnInsert: { organization } }, { upsert: true });
    return this.getSettings();
  }

  // ── What spend can be put against ─────────────────────────────────────────

  /** Hiring requests that were or are being recruited for, newest first. */
  async requisitions() {
    const rows = await JobRequisition.find({ organization: org(), status: { $in: RECRUITING } })
      .select("title department status priority createdAt")
      .populate("department", "name")
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    return rows.map((r) => ({
      _id: String(r._id),
      title: r.title,
      status: r.status,
      department: (r.department as { name?: string } | null)?.name ?? "",
    }));
  }

  /**
   * The platforms, for the candidate form's "source" list. Asked by anybody
   * who adds candidates, which is why it is not behind the ad spend permission.
   */
  async platformNames() {
    const s = await this.getSettings();
    return s.platforms.filter((p) => p.active).map((p) => p.label);
  }

  // ── Weeks ─────────────────────────────────────────────────────────────────

  private checkWeek(weekStart: string, today: string) {
    if (!isMonday(weekStart)) throw err("A week is named by its Monday (YYYY-MM-DD)", 400);
    if (weekStart > mondayOf(today)) throw err("That week has not started yet", 400);
  }

  private shape(doc: Record<string, unknown> | null) {
    if (!doc) return null;
    const d = doc as unknown as {
      lines: { _id?: unknown; requisition?: unknown; role: string; amounts: { platform: string; amount: number }[]; note?: string }[];
      attachments: { _id: unknown; key: string; fileName: string; contentType: string; size: number; uploadedBy?: unknown; uploadedAt: Date }[];
      loggedBy?: unknown; updatedBy?: unknown;
      history?: { at: Date; by?: unknown; action: string; total: number }[];
    } & Record<string, unknown>;
    return {
      ...d,
      _id: String(d._id),
      lines: d.lines.map((l) => ({
        _id: l._id ? String(l._id) : undefined,
        requisition: l.requisition ? String((l.requisition as { _id?: unknown })._id ?? l.requisition) : null,
        requisitionTitle: (l.requisition as { title?: string } | null)?.title ?? null,
        role: l.role,
        amounts: l.amounts,
        note: l.note ?? "",
        total: lineTotal(l),
      })),
      attachments: d.attachments.map((a) => ({ ...a, _id: String(a._id), url: publicUrl(a.key), uploadedBy: person(a.uploadedBy) })),
      loggedBy: person(d.loggedBy),
      updatedBy: person(d.updatedBy),
      history: (d.history ?? []).map((h) => ({ ...h, by: person(h.by) })),
    };
  }

  async getWeek(weekStart: string) {
    const organization = org();
    const s = await this.getSettings();
    if (!isMonday(weekStart)) throw err("A week is named by its Monday (YYYY-MM-DD)", 400);
    const doc = await AdSpendWeek.findOne({ organization, weekStart })
      .populate("loggedBy updatedBy attachments.uploadedBy history.by", "name")
      .populate("lines.requisition", "title")
      .lean();
    return { weekStart, weekEnd: weekEnd(weekStart), label: weekLabel(weekStart), future: weekStart > s.currentWeek, week: this.shape(doc as Record<string, unknown> | null) };
  }

  /**
   * Log a week, or correct one already logged. Saving replaces the week's
   * lines whole — the form always sends all of them — and records who saved it
   * and what the total became, so a changed figure is never anonymous.
   */
  async saveWeek(weekStart: string, input: SaveWeekInput, by: string) {
    const organization = org();
    const s = await this.getSettings();
    this.checkWeek(weekStart, s.today);

    const knownPlatforms = new Set(s.platforms.map((p) => p.key));
    for (const line of input.lines) {
      for (const a of line.amounts) {
        if (!knownPlatforms.has(a.platform)) throw err(`“${a.platform}” is not one of the platforms — add it in the settings first`, 400);
      }
    }
    const reqIds = [...new Set(input.lines.map((l) => l.requisition).filter((x): x is string => !!x))];
    if (reqIds.length) {
      const found = await JobRequisition.countDocuments({ organization, _id: { $in: reqIds } });
      if (found !== reqIds.length) throw err("One of the hiring requests is not this organisation's", 400);
    }

    const lines = input.nothingSpent ? [] : tidyLines(input.lines.map((l) => ({ ...l, requisition: l.requisition ?? null })));
    const total = weekTotal(lines);
    const now = new Date();
    const fields = {
      lines: lines.map((l) => ({ requisition: l.requisition ? new Types.ObjectId(l.requisition) : null, role: l.role, amounts: l.amounts, note: l.note ?? "" })),
      total,
      currency: s.currency,
      nothingSpent: input.nothingSpent,
      note: input.note ?? "",
      updatedBy: by,
    };

    const existing = await AdSpendWeek.findOne({ organization, weekStart }).select("_id").lean();
    if (existing) {
      await AdSpendWeek.updateOne(
        { _id: existing._id },
        { $set: fields, $push: { history: { at: now, by, action: "changed", total } } }
      );
    } else {
      try {
        await AdSpendWeek.create({
          organization, weekStart, ...fields, source: "entry", loggedBy: by, loggedAt: now,
          history: [{ at: now, by, action: "logged", total }],
        });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) throw err("Somebody saved this week a moment ago — reload it and try again", 409);
        throw e;
      }
    }
    return this.getWeek(weekStart);
  }

  async deleteWeek(weekStart: string) {
    const organization = org();
    const doc = await AdSpendWeek.findOneAndDelete({ organization, weekStart }).lean();
    if (!doc) throw err("That week has not been logged", 404);
    await Promise.all(doc.attachments.map((a) => deleteObject(a.key)));
    return { weekStart };
  }

  async addAttachment(weekStart: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }, by: string) {
    const organization = org();
    const week = await AdSpendWeek.findOne({ organization, weekStart }).select("attachments").lean();
    if (!week) throw err("Save the week first, then attach its invoices", 400);
    if (week.attachments.length >= MAX_ATTACHMENTS) throw err(`A week holds up to ${MAX_ATTACHMENTS} files`, 400);
    const key = attachmentKey(String(organization), by, "ad-spend", documentExt(file.mimetype), Date.now());
    await putObject(key, file.buffer, file.mimetype);
    await AdSpendWeek.updateOne(
      { _id: week._id },
      { $push: { attachments: { key, fileName: file.originalname.slice(0, 200), contentType: file.mimetype, size: file.size, uploadedBy: by, uploadedAt: new Date() } } }
    );
    return this.getWeek(weekStart);
  }

  async removeAttachment(weekStart: string, attachmentId: string) {
    const organization = org();
    const week = await AdSpendWeek.findOne({ organization, weekStart }).select("attachments").lean();
    const file = week?.attachments.find((a) => String(a._id) === attachmentId);
    if (!week || !file) throw err("That file is not on this week", 404);
    await AdSpendWeek.updateOne({ _id: week._id }, { $pull: { attachments: { _id: file._id } } });
    await deleteObject(file.key);
    return this.getWeek(weekStart);
  }

  /** Weeks logged in a range of months, newest first, and the finished weeks in it nobody logged. */
  async listWeeks(from: string, to: string) {
    const organization = org();
    const s = await this.getSettings();
    const inRange = (w: string) => monthOfWeek(w) >= from && monthOfWeek(w) <= to;
    const rows = (await AdSpendWeek.find({ organization, weekStart: weekRangeForMonths(from, to) })
      .select("weekStart total nothingSpent lines.role lines.amounts attachments._id loggedBy loggedAt updatedAt source")
      .populate("loggedBy", "name")
      .sort({ weekStart: -1 })
      .lean()).filter((r) => inRange(r.weekStart));
    const missing = (await this.missing(s)).filter(inRange);
    return {
      weeks: rows.map((r) => ({
        weekStart: r.weekStart,
        label: weekLabel(r.weekStart),
        total: r.total,
        nothingSpent: r.nothingSpent,
        roles: r.lines.map((l) => l.role),
        attachments: r.attachments.length,
        source: r.source,
        loggedBy: person(r.loggedBy),
        loggedAt: r.loggedAt,
        updatedAt: r.updatedAt,
      })),
      missing: missing.map((w) => ({ weekStart: w, label: weekLabel(w) })),
    };
  }

  /** Finished weeks owed since the log started and not logged. */
  private async missing(s: AdSpendSettingsView): Promise<string[]> {
    if (!s.trackingFrom) return [];
    const logged = await AdSpendWeek.find({ organization: org(), weekStart: { $gte: mondayOf(s.trackingFrom) } }).select("weekStart").lean();
    return missingWeeks(s.trackingFrom, s.today, logged.map((w) => w.weekStart)).reverse();
  }

  // ── The overview ──────────────────────────────────────────────────────────

  /**
   * Spend over a range of months: by month and platform against the budget,
   * by platform against the candidates it brought, and by role against the
   * applications and hires its hiring request got.
   *
   * A week counts in the month holding most of its days (see monthOfWeek) —
   * a week's spend is one figure, and splitting it by day would invent
   * numbers nobody entered. Candidates and applications count by when they were added,
   * over the same months, so a cost per candidate compares like with like.
   */
  async overview(fromMonth?: string, toMonth?: string) {
    const organization = org();
    const s = await this.getSettings();
    const thisMonth = s.today.slice(0, 7);
    const to = toMonth ?? thisMonth;
    const from = fromMonth ?? addMonths(to, -5);
    if (from > to) throw err("The range starts after it ends", 400);
    const months = monthsBetween(from, to);
    const labels = new Map(s.platforms.map((p) => [p.key, p.label]));

    const weeks = (await AdSpendWeek.find({ organization, weekStart: weekRangeForMonths(from, to) })
      .select("weekStart total nothingSpent lines")
      .populate("lines.requisition", "title status")
      .lean()).filter((w) => monthOfWeek(w.weekStart) >= from && monthOfWeek(w.weekStart) <= to);

    const byMonth = new Map(months.map((m) => [m, { month: m, total: 0, byPlatform: {} as Record<string, number> }]));
    const byPlatform = new Map<string, number>();
    type RoleRow = { key: string; role: string; requisition: { _id: string; title: string; status: string } | null; total: number; byPlatform: Record<string, number>; weeks: Set<string> };
    const byRole = new Map<string, RoleRow>();

    for (const w of weeks) {
      const month = byMonth.get(monthOfWeek(w.weekStart));
      for (const line of w.lines) {
        const req = line.requisition as unknown as { _id: unknown; title?: string; status?: string } | null;
        const roleKey = req ? `req:${String(req._id)}` : `name:${line.role.trim().toLowerCase()}`;
        let row = byRole.get(roleKey);
        if (!row) {
          row = {
            key: roleKey,
            role: req?.title ?? line.role,
            requisition: req ? { _id: String(req._id), title: req.title ?? line.role, status: req.status ?? "" } : null,
            total: 0, byPlatform: {}, weeks: new Set(),
          };
          byRole.set(roleKey, row);
        }
        row.weeks.add(w.weekStart);
        for (const a of line.amounts) {
          if (!a.amount) continue;
          if (month) {
            month.total += a.amount;
            month.byPlatform[a.platform] = (month.byPlatform[a.platform] ?? 0) + a.amount;
          }
          byPlatform.set(a.platform, (byPlatform.get(a.platform) ?? 0) + a.amount);
          row.total += a.amount;
          row.byPlatform[a.platform] = (row.byPlatform[a.platform] ?? 0) + a.amount;
        }
      }
    }

    // Candidates and applications added over the same months.
    const start = zonedTimeToUtc(`${from}-01`, "00:00", s.timeZone);
    const end = zonedTimeToUtc(`${addMonths(to, 1)}-01`, "00:00", s.timeZone);
    const candidates = await Candidate.find({ organization, createdAt: { $gte: start, $lt: end } }).select("source").lean();
    const reqIds = [...byRole.values()].filter((r) => r.requisition).map((r) => new Types.ObjectId(r.requisition!._id));
    const applications = reqIds.length
      ? await Application.aggregate<{ _id: Types.ObjectId; applications: number; hired: number }>([
          { $match: { organization, requisition: { $in: reqIds }, createdAt: { $gte: start, $lt: end } } },
          { $group: { _id: "$requisition", applications: { $sum: 1 }, hired: { $sum: { $cond: [{ $eq: ["$stage", "hired"] }, 1, 0] } } } },
        ])
      : [];
    const appsByReq = new Map(applications.map((a) => [String(a._id), a]));

    const platformKeys = [...new Set([...s.platforms.filter((p) => p.active).map((p) => p.key), ...byPlatform.keys()])];
    const platforms = platformKeys.map((key) => {
      const platform = { key, label: labels.get(key) ?? key };
      const spend = round2(byPlatform.get(key) ?? 0);
      const count = candidates.filter((c) => sourceIsPlatform(c.source, platform)).length;
      return { ...platform, active: s.platforms.find((p) => p.key === key)?.active ?? false, spend, candidates: count, costPerCandidate: count ? round2(spend / count) : null };
    });

    const roles = [...byRole.values()]
      .map((r) => {
        const apps = r.requisition ? appsByReq.get(r.requisition._id) : undefined;
        const total = round2(r.total);
        return {
          key: r.key, role: r.role, requisition: r.requisition, total,
          byPlatform: Object.fromEntries(Object.entries(r.byPlatform).map(([k, v]) => [k, round2(v)])),
          weeks: r.weeks.size,
          applications: r.requisition ? (apps?.applications ?? 0) : null,
          hired: r.requisition ? (apps?.hired ?? 0) : null,
          costPerApplication: apps?.applications ? round2(total / apps.applications) : null,
          costPerHire: apps?.hired ? round2(total / apps.hired) : null,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

    const spend = round2([...byPlatform.values()].reduce((a, b) => a + b, 0));

    // This month and last week are about now, whatever range is being looked at.
    const monthWeeks = thisMonth >= from && thisMonth <= to
      ? null
      : (await AdSpendWeek.find({ organization, weekStart: weekRangeForMonths(thisMonth, thisMonth) }).select("weekStart total").lean())
          .filter((w) => monthOfWeek(w.weekStart) === thisMonth);
    const thisMonthSpend = round2(monthWeeks ? monthWeeks.reduce((a, w) => a + w.total, 0) : byMonth.get(thisMonth)?.total ?? 0);
    const last = await AdSpendWeek.findOne({ organization, weekStart: s.lastWeek }).select("total nothingSpent").lean();
    const missing = await this.missing(s);

    return {
      from, to,
      currency: s.currency,
      monthlyBudget: s.monthlyBudget,
      trackingFrom: s.trackingFrom,
      months: [...byMonth.values()].map((m) => ({
        month: m.month,
        total: round2(m.total),
        byPlatform: Object.fromEntries(Object.entries(m.byPlatform).map(([k, v]) => [k, round2(v)])),
        overBudget: s.monthlyBudget > 0 && round2(m.total) > s.monthlyBudget,
      })),
      platforms,
      roles,
      totals: {
        spend,
        weeksLogged: weeks.length,
        candidates: candidates.length,
        candidatesFromAds: candidates.filter((c) => s.platforms.some((p) => sourceIsPlatform(c.source, p))).length,
      },
      thisMonth: { month: thisMonth, spend: thisMonthSpend, budget: s.monthlyBudget },
      lastWeek: {
        weekStart: s.lastWeek,
        label: weekLabel(s.lastWeek),
        status: last ? (last.nothingSpent ? "nothing" : "logged") : s.trackingFrom && s.lastWeek >= mondayOf(s.trackingFrom) ? "missing" : "not_tracked",
        total: last?.total ?? 0,
      },
      missing: missing.map((w) => ({ weekStart: w, label: weekLabel(w) })),
    };
  }

  // ── Reminders ─────────────────────────────────────────────────────────────

  /**
   * Whoever logs the spend. HR can log a week too — to correct one — but it is
   * the recruiter's job, so the reminder goes to those who may log weeks and
   * not set the budget. Only when nobody fits that does it go to everybody who
   * may log, so a missing week is never nobody's to hear about.
   */
  private async loggers(): Promise<Types.ObjectId[]> {
    const organization = org();
    const roles = await Role.find({
      "permissions.adSpend.create": true,
      $or: [{ organization }, { organization: null }],
    }).select("_id roleName isSystemRole permissions.adSpend").lean();
    const eligible = roles.filter((r) => !(r.isSystemRole && r.roleName === "Super Admin"));
    const usersOf = async (ids: Types.ObjectId[]) =>
      ids.length ? (await User.find({ organization, role: { $in: ids }, status: "active" }).select("_id").lean()).map((u) => u._id) : [];
    const recruiters = await usersOf(eligible.filter((r) => !(r.permissions as { adSpend?: { edit?: boolean } })?.adSpend?.edit).map((r) => r._id));
    return recruiters.length ? recruiters : usersOf(eligible.map((r) => r._id));
  }

  /**
   * Remind whoever logs the spend that last week is not in yet. Run Monday
   * morning, and again Wednesday for a week still missing — by then the late
   * week also shows on HR's overview, so nobody has to chase it by hand.
   *
   * Nothing at all until the organisation has said from when the log is owed:
   * a tenant that never advertises should never hear about this.
   */
  async remindDue(now = new Date()): Promise<number> {
    const s = await this.getSettings(now);
    if (!s.trackingFrom || s.lastWeek < mondayOf(s.trackingFrom)) return 0;
    if (await AdSpendWeek.exists({ organization: org(), weekStart: s.lastWeek })) return 0;
    const users = await this.loggers();
    if (!users.length) return 0;
    const waiting = (await this.missing(s)).length;
    const monday = new Date(`${s.today}T00:00:00Z`).getUTCDay() === 1;
    return notify({
      users,
      organization: org(),
      kind: "reminder",
      tone: monday ? "neutral" : "negative",
      title: monday ? "Log last week's ad spend" : "Last week's ad spend isn't logged yet",
      body: `${weekLabel(s.lastWeek)}${waiting > 1 ? ` · ${waiting} weeks waiting` : ""}. Enter what went on each platform, or mark it as nothing spent.`,
      href: `/hiring/ad-spend?week=${s.lastWeek}`,
    });
  }
}

