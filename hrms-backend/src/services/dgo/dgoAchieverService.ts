import type { Types } from "mongoose";
import { env } from "../../config/env.js";
import { DgoAchieverMonth } from "../../models/DgoAchieverMonth.js";
import { DgoBudgetPeriod } from "../../models/DgoBudgetPeriod.js";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { User } from "../../models/User.js";
import { notify } from "../notificationService.js";
import { ACTIVE_EMPLOYEE_STATUSES, ELITE_RULE_PREFIX, MENTOR_METRICS, type DgoEliteCategory, type DgoEliteMetric } from "./dgoDefaults.js";
import { dayIn, isMonth, previousMonth, toAed, toFils } from "./dgoMath.js";
import { httpError, isDuplicateKey } from "./dgoErrors.js";
import { programSettings, settingsOn } from "./dgoSettingsService.js";
import { commitElite, ensurePeriod } from "./dgoBudgetService.js";
import { AlreadyCredited, creditEvent, type Actor } from "./dgoLedgerService.js";
import { inTransaction } from "./dgoTxn.js";
import { assertMonthOpen } from "./dgoCloseService.js";
import { dgoAudit } from "./dgoAudit.js";
import {
  assertCanUse, canApproveAchievers, canReviewAchievers, canRunAchievers, canVerifyAchievers, usersWith, type DgoViewer,
} from "./dgoAccess.js";

/**
 * Monthly achievers (the elite awards).
 *
 * After a month ends, HRMS asks Root for each person's month — Dubai sales and
 * team totals as the CRMs' leaderboards count them, CS course payments
 * collected, mentor KPI scores, who took a gift — matches them to employees by
 * email and ranks every category against its threshold. Finance verifies the
 * amounts; somebody else approves, which pays every prize as points from the
 * month's elite pool and publishes the winners.
 *
 * Locked when finance's confirmed collections for the month left the elite pool
 * at zero (under AED 1.2m). A salesperson or team leader who took a Root gift
 * that month is passed over (gift rewards are their own, separately funded
 * campaign). Exact ties at a deciding place are left for a person to pick.
 */

/* ───────────── Root ───────────── */

export interface RootMetrics {
  month: string;
  generatedAt?: string;
  sales: Array<{ email: string; name: string; crm: string; team: string | null; salesAed: number; giftClaimed: boolean }>;
  teams: Array<{ crm: string; team: string; leaderEmail: string; leaderName: string; salesAed: number; leaderGiftClaimed: boolean }>;
  cs: Array<{ email: string; name: string; role: "cs" | "cs_manager"; collectedAed: number }>;
  csDepartment: { collectedAed: number };
  mentors: Array<{ email: string; name: string; role: "chief_mentor" | "senior_mentor" | "junior_mentor"; score: number | null; coverage: number | null }>;
  problems: string[];
}

type Fetcher = (month: string) => Promise<RootMetrics>;

async function askRoot(month: string): Promise<RootMetrics> {
  const base = env.ROOT_ERP_API_URL.replace(/\/+$/, "");
  if (!base || !env.ROOT_ERP_SECRET) throw httpError("Root isn't set up on this server yet (ROOT_ERP_API_URL and ROOT_ERP_SECRET), so its figures can't be fetched", 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${base}/api/v1/service/dgo/achiever-metrics?month=${encodeURIComponent(month)}`, {
      headers: { "x-portal-secret": env.ROOT_ERP_SECRET, accept: "application/json" },
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string; data?: RootMetrics } | null;
    if (!res.ok || !body?.data) throw httpError(`Root couldn't be asked: ${body?.message ?? `HTTP ${res.status}`}`, 502);
    return body.data;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode) throw e;
    throw httpError(`Root couldn't be asked: ${(e as Error).name === "AbortError" ? "it took too long" : (e as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

let fetcher: Fetcher = askRoot;
/** The check script stands Root in with fake figures. */
export const setRootFetcherForTest = (f: Fetcher | null) => { fetcher = f ?? askRoot; };

/* ───────────── ranking ───────────── */

interface Candidate {
  email: string;
  name: string;
  employee: Types.ObjectId | null;
  employeeName: string | null;
  value: number;
  detail: string | null;
  eligible: boolean;
  why: string | null;
  tied: boolean;
}

interface CategoryResult {
  code: string; name: string; metric: DgoEliteMetric; place: number; threshold: number; prizeAed: number; prizePoints: number;
  winner: Candidate | null; tie: boolean; pickedBy: unknown; pickedByName: string | null; candidates: Candidate[]; awardEvent: unknown;
}

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en")}`;

/** Every address in the figures, matched to a current employee of this organisation (work email, then login email). */
async function matchEmails(orgId: string, emails: string[]) {
  const set = [...new Set(emails.map(lower).filter(Boolean))];
  const out = new Map<string, { id: Types.ObjectId; name: string }>();
  if (!set.length) return out;
  const users = await User.find({ email: { $in: set } }).select("_id email").lean<Array<{ _id: unknown; email: string }>>();
  const userEmail = new Map(users.map((u) => [String(u._id), lower(u.email)]));
  const emps = await Employee.find({
    organization: orgId,
    $or: [{ email: { $in: set } }, ...(users.length ? [{ user: { $in: users.map((u) => u._id) } }] : [])],
  }).select("_id name email user status").lean<Array<{ _id: Types.ObjectId; name: string; email?: string; user?: unknown; status: string }>>();
  // Work email first, then login; a current employee before one who has left.
  const ranked = [...emps].sort((a, b) => Number(!ACTIVE_EMPLOYEE_STATUSES.includes(a.status)) - Number(!ACTIVE_EMPLOYEE_STATUSES.includes(b.status)));
  for (const e of ranked) {
    if (!ACTIVE_EMPLOYEE_STATUSES.includes(e.status)) continue;
    const work = lower(e.email);
    if (work && set.includes(work) && !out.has(work)) out.set(work, { id: e._id, name: e.name });
  }
  for (const e of ranked) {
    if (!ACTIVE_EMPLOYEE_STATUSES.includes(e.status)) continue;
    const login = e.user ? userEmail.get(String(e.user)) : undefined;
    if (login && !out.has(login)) out.set(login, { id: e._id, name: e.name });
  }
  return out;
}

interface Raw { email: string; name: string; value: number; detail: string | null; gift: boolean }

/** The people a metric ranks, best first. */
function rawFor(metric: DgoEliteMetric, m: RootMetrics): Raw[] {
  switch (metric) {
    case "sales": {
      const by = new Map<string, Raw & { crms: string[] }>();
      for (const s of m.sales ?? []) {
        const k = lower(s.email);
        if (!k) continue;
        const cur = by.get(k) ?? { email: k, name: s.name, value: 0, detail: null, gift: false, crms: [] };
        cur.value += Number(s.salesAed) || 0;
        cur.gift = cur.gift || Boolean(s.giftClaimed);
        if (!cur.crms.includes(s.crm)) cur.crms.push(s.crm);
        by.set(k, cur);
      }
      return [...by.values()].map((r) => ({ ...r, detail: r.crms.map(crmName).join(" + ") }));
    }
    case "team":
      return (m.teams ?? []).filter((t) => lower(t.leaderEmail)).map((t) => ({
        email: lower(t.leaderEmail), name: t.leaderName, value: Number(t.salesAed) || 0, detail: `${t.team} (${crmName(t.crm)})`, gift: Boolean(t.leaderGiftClaimed),
      }));
    case "cs":
      return (m.cs ?? []).filter((c) => c.role === "cs" && lower(c.email)).map((c) => ({ email: lower(c.email), name: c.name, value: Number(c.collectedAed) || 0, detail: null, gift: false }));
    case "cs_department": {
      const total = Number(m.csDepartment?.collectedAed) || 0;
      return (m.cs ?? []).filter((c) => c.role === "cs_manager" && lower(c.email)).map((c) => ({ email: lower(c.email), name: c.name, value: total, detail: "CS department total", gift: false }));
    }
    default: {
      const role = metric === "mentor_chief" ? "chief_mentor" : metric === "mentor_senior" ? "senior_mentor" : "junior_mentor";
      return (m.mentors ?? []).filter((x) => x.role === role && lower(x.email) && x.score != null).map((x) => ({
        email: lower(x.email), name: x.name, value: Number(x.score) || 0, detail: x.coverage != null ? `coverage ${Math.round(x.coverage)}%` : null, gift: false,
      }));
    }
  }
}

const crmName = (c: string) => (c === "delta" ? "Delta" : c === "draw" ? "Draw" : c === "remote" ? "Remote" : c);

/**
 * Rank every active category. Within one metric a person wins one place at
 * most (first, then the next eligible person takes second). An exact tie at a
 * deciding place leaves the winner empty for a person to pick.
 */
export function rankCategories(categories: DgoEliteCategory[], m: RootMetrics, matched: Map<string, { id: Types.ObjectId; name: string }>, pointValueAed: number): CategoryResult[] {
  const results: CategoryResult[] = [];
  const takenByMetric = new Map<string, Set<string>>();
  for (const c of [...categories].filter((x) => x.active).sort((a, b) => a.metric.localeCompare(b.metric) || a.place - b.place)) {
    const mentor = MENTOR_METRICS.includes(c.metric);
    const raws = rawFor(c.metric, m).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const taken = takenByMetric.get(c.metric) ?? new Set<string>();
    const all: Candidate[] = raws.map((r) => {
      const emp = matched.get(r.email) ?? null;
      let why: string | null = null;
      if (r.value < c.threshold) why = mentor ? `Score under ${c.threshold}` : `Under ${aed(c.threshold)}`;
      else if (r.gift) why = "Took a gift this month";
      else if (!emp) why = "Not found in HRMS";
      else if (taken.has(r.email)) why = "Already placed higher";
      return { email: r.email, name: r.name, employee: emp?.id ?? null, employeeName: emp?.name ?? null, value: r.value, detail: r.detail, eligible: !why, why, tied: false };
    });
    const eligible = all.filter((x) => x.eligible);
    let winner: Candidate | null = eligible[0] ?? null;
    let tie = false;
    if (winner && eligible.length > 1 && eligible[1].value === winner.value) {
      tie = true;
      for (const x of eligible) if (x.value === winner.value) x.tied = true;
      winner = null;
    }
    if (winner) taken.add(winner.email);
    takenByMetric.set(c.metric, taken);
    results.push({
      code: c.code, name: c.name, metric: c.metric, place: c.place, threshold: c.threshold, prizeAed: c.prizeAed,
      prizePoints: Math.round(c.prizeAed / pointValueAed),
      winner, tie, pickedBy: null, pickedByName: null, candidates: all.slice(0, 8), awardEvent: null,
    });
  }
  // Back in the categories' own order.
  const order = new Map(categories.map((c, i) => [c.code, i]));
  return results.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
}

/* ───────────── month document ───────────── */

interface MonthDoc {
  _id: Types.ObjectId;
  organization: unknown;
  month: string;
  status: "provisional" | "locked" | "verified" | "approved" | "published";
  lockedReason: string | null;
  problems: string[];
  pointValueAed: number;
  categories: CategoryResult[];
  fetchedAt: Date | null; fetchedBy: unknown; fetchedByName: string | null;
  verifiedAt: Date | null; verifiedBy: unknown; verifiedByName: string | null;
  approvedBy: unknown; approvedByName: string | null;
  publishedAt: Date | null; publishedByName: string | null;
  trail: Array<{ action: string; byName: string | null; note: string | null; at: Date }>;
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const trailEntry = (action: string, v: DgoViewer, note: string | null = null) => ({ action, by: v.userId, byName: v.name, note, at: new Date() });

function monthOrLast(v: DgoViewer, monthIn?: string): string {
  const thisMonth = dayIn(v.tz).slice(0, 7);
  const m = monthIn || previousMonth(thisMonth);
  if (!isMonth(m)) throw httpError("month must be YYYY-MM", 400);
  if (m > thisMonth) throw httpError("That month hasn't started", 400);
  return m;
}

async function poolOf(orgId: string, month: string) {
  const [period, settings] = await Promise.all([
    DgoBudgetPeriod.findOne({ organization: orgId, month }).lean<{ eliteFils: number; eliteCommittedFils?: number; collections?: { confirmedFils: number | null } }>(),
    settingsOn(orgId, `${month}-01`),
  ]);
  const eliteTier = [...settings.tiers].sort((a, b) => a.minCollections - b.minCollections).find((t) => t.eliteAed > 0);
  return {
    eliteFils: period?.eliteFils ?? 0,
    committedFils: period?.eliteCommittedFils ?? 0,
    confirmedFils: period?.collections?.confirmedFils ?? null,
    thresholdAed: eliteTier?.minCollections ?? 0,
  };
}

function cleanCandidate(c: Candidate | null, review: boolean) {
  if (!c) return null;
  return {
    email: review ? c.email : "",
    name: c.name,
    employeeId: c.employee ? String(c.employee) : null,
    employeeName: c.employeeName ?? null,
    value: review ? c.value : 0,
    detail: review ? c.detail ?? null : null,
    eligible: c.eligible,
    why: c.why ?? null,
    tied: Boolean(c.tied),
  };
}

async function view(v: DgoViewer, month: string) {
  const review = canReviewAchievers(v);
  if (!review) await assertCanUse(v);
  const thisMonth = dayIn(v.tz).slice(0, 7);
  const [doc, pool, recent] = await Promise.all([
    DgoAchieverMonth.findOne({ organization: v.orgId, month }).lean<MonthDoc>(),
    poolOf(v.orgId, month),
    DgoAchieverMonth.find({ organization: v.orgId }).select("month status").sort({ month: -1 }).limit(24).lean<Array<{ month: string; status: string }>>(),
  ]);
  const statusOf = (s?: string) => (!s ? "none" : s === "approved" ? "verified" : s) as "none" | "provisional" | "locked" | "verified" | "published";
  const known = new Map(recent.map((r) => [r.month, r.status]));
  const months: Array<{ month: string; status: ReturnType<typeof statusOf> }> = [];
  for (let m = previousMonth(thisMonth), i = 0; i < 12; i++, m = previousMonth(m)) months.push({ month: m, status: statusOf(known.get(m)) });

  const published = doc?.status === "published";
  const showAll = review || published;
  const cats = (doc?.categories ?? []).filter((c) => review || (published && c.winner && c.awardEvent));
  const prizesFils = (doc?.categories ?? []).filter((c) => c.winner).reduce((s, c) => s + toFils(c.prizeAed), 0);
  const unpaidFils = (doc?.categories ?? []).filter((c) => c.winner && !c.awardEvent).reduce((s, c) => s + toFils(c.prizeAed), 0);
  const status = statusOf(doc?.status);
  const awards = published
    ? await DgoEarningEvent.find({ _id: { $in: cats.map((c) => c.awardEvent).filter(Boolean) } }).select("employeeName points status").lean<Array<{ _id: unknown; employeeName: string; points: number; status: string }>>()
    : [];
  const awardBy = new Map(awards.map((a) => [String(a._id), a]));
  // A prize finance took back is no longer announced; reviewers still see it, marked.
  const shown = review ? cats : cats.filter((c) => awardBy.get(String(c.awardEvent))?.status === "posted");
  const isVerifier = doc?.verifiedBy && String(doc.verifiedBy) === v.userId;
  return {
    month,
    status,
    review,
    pool: {
      eliteAed: toAed(pool.eliteFils),
      prizesAed: toAed(prizesFils),
      fits: published || unpaidFils === 0 || unpaidFils + pool.committedFils <= pool.eliteFils,
      collectionsConfirmedAed: pool.confirmedFils != null ? toAed(pool.confirmedFils) : null,
      thresholdAed: pool.thresholdAed,
    },
    lockedReason: doc?.lockedReason ?? null,
    problems: review ? doc?.problems ?? [] : [],
    fetchedAt: iso(doc?.fetchedAt), fetchedByName: review ? doc?.fetchedByName ?? null : null,
    verifiedAt: iso(doc?.verifiedAt), verifiedByName: review ? doc?.verifiedByName ?? null : null,
    publishedAt: iso(doc?.publishedAt), publishedByName: doc?.publishedByName ?? null,
    categories: showAll ? shown.map((c) => {
      const award = c.awardEvent ? awardBy.get(String(c.awardEvent)) : undefined;
      return {
        code: c.code, name: c.name, metric: c.metric, place: c.place, threshold: c.threshold, prizeAed: c.prizeAed, prizePoints: c.prizePoints,
        winner: cleanCandidate(c.winner, review),
        tie: c.tie && !c.winner,
        pickedByName: review ? c.pickedByName ?? null : null,
        candidates: review ? c.candidates.map((x) => cleanCandidate(x, true)!) : [],
        award: award ? { eventId: String(award._id), employeeName: award.employeeName, points: award.points, takenBack: award.status !== "posted" } : null,
      };
    }) : [],
    trail: review ? (doc?.trail ?? []).map((t) => ({ action: t.action, byName: t.byName ?? null, note: t.note ?? null, at: iso(t.at)! })) : [],
    months,
    can: {
      fetch: canRunAchievers(v) && month < thisMonth && (!doc || doc.status === "provisional" || doc.status === "locked"),
      pick: canRunAchievers(v) && doc?.status === "provisional" && doc.categories.some((c) => c.tie && !c.winner),
      verify: canVerifyAchievers(v) && doc?.status === "provisional",
      sendBack: (canVerifyAchievers(v) || canApproveAchievers(v)) && doc?.status === "verified",
      approve: canApproveAchievers(v) && (doc?.status === "verified" || doc?.status === "approved") && !isVerifier,
    },
  };
}

/** GET /dgo-points/achievers?month= */
export async function achieversView(v: DgoViewer, monthIn?: string) {
  return view(v, monthOrLast(v, monthIn));
}

/** POST /achievers/:month/fetch — ask Root, match, rank. Again and again while provisional; never once verified. */
export async function fetchAchievers(v: DgoViewer, monthIn: string) {
  if (!canRunAchievers(v)) throw httpError("You can't fetch monthly achiever figures", 403);
  const month = monthOrLast(v, monthIn);
  if (month >= dayIn(v.tz).slice(0, 7)) throw httpError("Achievers are decided once the month is over", 400);
  const existing = await DgoAchieverMonth.findOne({ organization: v.orgId, month }).lean<MonthDoc>();
  if (existing && !["provisional", "locked"].includes(existing.status)) throw httpError(`${month} is already ${existing.status === "published" ? "published" : "verified"} — send it back first`, 409);
  await assertMonthOpen(v.orgId, month, "its achievers can't change");

  const figures = await fetcher(month);
  const settings = await settingsOn(v.orgId, `${month}-01`);
  const program = await programSettings(v.orgId);
  const emails = [
    ...(figures.sales ?? []).map((s) => s.email), ...(figures.teams ?? []).map((t) => t.leaderEmail),
    ...(figures.cs ?? []).map((c) => c.email), ...(figures.mentors ?? []).map((x) => x.email),
  ];
  const matched = await matchEmails(v.orgId, emails);
  const categories = rankCategories(program.eliteCategories, figures, matched, settings.pointValueAed);
  await ensurePeriod(v.orgId, month);
  const pool = await poolOf(v.orgId, month);
  const locked = pool.confirmedFils != null && pool.eliteFils <= 0;
  const lockedReason = locked
    ? `Confirmed collections for ${month} were ${aed(toAed(pool.confirmedFils!))}; monthly achievers need ${aed(pool.thresholdAed)}`
    : null;
  const status = locked ? "locked" : "provisional";
  const note = `${categories.filter((c) => c.winner).length} of ${categories.length} categories have a winner${categories.some((c) => c.tie) ? "; a tie to pick" : ""}${figures.problems?.length ? `; ${figures.problems.length} source(s) couldn't be read` : ""}`;
  await DgoAchieverMonth.updateOne(
    { organization: v.orgId, month },
    {
      $set: {
        status, lockedReason, problems: figures.problems ?? [], pointValueAed: settings.pointValueAed, categories,
        fetchedAt: new Date(), fetchedBy: v.userId, fetchedByName: v.name,
        verifiedAt: null, verifiedBy: null, verifiedByName: null, approvedBy: null, approvedByName: null,
      },
      $push: { trail: trailEntry(locked ? "locked" : "fetched", v, lockedReason ?? note) },
      $setOnInsert: { organization: v.orgId, month },
    },
    { upsert: true }
  );
  await dgoAudit(v, "achievers_fetched", "achiever_month", month, existing ? { status: existing.status } : null, { status, winners: categories.filter((c) => c.winner).map((c) => `${c.code}:${c.winner!.name}`) });
  return { ...(await view(v, month)), message: locked ? "Locked: the elite pool is closed this month" : "Figures fetched from Root" };
}

/** POST /achievers/:month/pick — choose between exactly tied candidates. */
export async function pickWinner(v: DgoViewer, monthIn: string, code: string, email: string) {
  if (!canRunAchievers(v)) throw httpError("You can't pick achievers", 403);
  const month = monthOrLast(v, monthIn);
  const doc = await DgoAchieverMonth.findOne({ organization: v.orgId, month }).lean<MonthDoc>();
  if (!doc || doc.status !== "provisional") throw httpError("Only a provisional month can be changed", 409);
  const cat = doc.categories.find((c) => c.code === code);
  if (!cat) throw httpError("Unknown category", 400);
  if (!cat.tie) throw httpError("There's no tie to pick in that category", 409);
  const chosen = cat.candidates.find((c) => c.email === lower(email) && c.tied && c.eligible);
  if (!chosen) throw httpError("Pick one of the tied candidates", 400);
  if (chosen.employee && v.employee && String(chosen.employee) === v.employee._id) throw httpError("You can't pick yourself", 403);
  // A person picked here can't also be the next place's winner in the same metric: the next place recomputes on fetch, so stop a double.
  const sameMetricWinner = doc.categories.find((c) => c.metric === cat.metric && c.code !== code && c.winner?.email === chosen.email);
  if (sameMetricWinner) throw httpError(`${chosen.name} already wins ${sameMetricWinner.name}`, 409);
  const r = await DgoAchieverMonth.updateOne(
    { _id: doc._id, status: "provisional", "categories.code": code },
    {
      $set: { "categories.$.winner": { ...chosen, tied: true }, "categories.$.pickedBy": v.userId, "categories.$.pickedByName": v.name },
      $push: { trail: trailEntry("picked", v, `${cat.name}: ${chosen.name}`) },
    }
  );
  if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
  await dgoAudit(v, "achiever_picked", "achiever_month", month, { code, tie: true }, { code, winner: chosen.name });
  return { ...(await view(v, month)), message: `${chosen.name} picked for ${cat.name}` };
}

/** POST /achievers/:month/verify — finance: the amounts are right, the pool is open, the prizes fit. */
export async function verifyAchievers(v: DgoViewer, monthIn: string, note?: string | null) {
  if (!canVerifyAchievers(v)) throw httpError("Only finance verifies monthly achievers", 403);
  const month = monthOrLast(v, monthIn);
  const doc = await DgoAchieverMonth.findOne({ organization: v.orgId, month }).lean<MonthDoc>();
  if (!doc) throw httpError("Fetch the figures first", 409);
  if (doc.status === "verified" && String(doc.verifiedBy) === v.userId) return { ...(await view(v, month)), message: "Already done" };
  if (doc.status !== "provisional") throw httpError(doc.status === "locked" ? doc.lockedReason ?? "Locked" : `Already ${doc.status}`, 409);
  await assertMonthOpen(v.orgId, month, "its achievers can't change");
  const pool = await poolOf(v.orgId, month);
  if (pool.confirmedFils == null) throw httpError(`Finance hasn't confirmed ${month}'s collections yet (Points Budgets)`, 409);
  if (pool.eliteFils <= 0) throw httpError("The elite pool is closed this month", 409);
  if (doc.categories.some((c) => c.tie && !c.winner)) throw httpError("Pick the winner where there's a tie first", 409);
  const prizes = doc.categories.filter((c) => c.winner).reduce((s, c) => s + toFils(c.prizeAed), 0);
  if (prizes + pool.committedFils > pool.eliteFils) throw httpError(`The prizes (${aed(toAed(prizes))}) don't fit what's left of the elite pool (${aed(toAed(pool.eliteFils - pool.committedFils))})`, 409);
  const r = await DgoAchieverMonth.updateOne(
    { _id: doc._id, status: "provisional" },
    { $set: { status: "verified", verifiedAt: new Date(), verifiedBy: v.userId, verifiedByName: v.name }, $push: { trail: trailEntry("verified", v, note?.trim() || null) } }
  );
  if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
  await dgoAudit(v, "achievers_verified", "achiever_month", month, { status: "provisional" }, { status: "verified" });
  const approvers = (await usersWith(v.orgId, "dgoSettings", "approve").catch(() => [])).filter((u) => u !== v.userId);
  await notify({ users: approvers, kind: "approval", organization: v.orgId, actor: v.userId, title: `Monthly achievers for ${month} to approve`, body: `Verified by ${v.name}`, href: `/dgo-points/achievers?month=${month}` });
  return { ...(await view(v, month)), message: "Verified — a second person approves and publishes" };
}

/** POST /achievers/:month/send-back — back to provisional, with why. */
export async function sendBackAchievers(v: DgoViewer, monthIn: string, reason: string) {
  if (!canVerifyAchievers(v) && !canApproveAchievers(v)) throw httpError("You can't send this back", 403);
  if (!reason?.trim()) throw httpError("Say why it goes back", 400);
  const month = monthOrLast(v, monthIn);
  const r = await DgoAchieverMonth.updateOne(
    { organization: v.orgId, month, status: "verified" },
    { $set: { status: "provisional", verifiedAt: null, verifiedBy: null, verifiedByName: null }, $push: { trail: trailEntry("sent_back", v, reason.trim()) } }
  );
  if (!r.modifiedCount) throw httpError("Only a verified month can be sent back", 409);
  await dgoAudit(v, "achievers_sent_back", "achiever_month", month, { status: "verified" }, { status: "provisional", reason: reason.trim() });
  return { ...(await view(v, month)), message: "Sent back" };
}

/**
 * POST /achievers/:month/approve — a second person (never the verifier):
 * every winner's prize posted as points from the elite pool, then published.
 * Repeat-safe: each prize is one earning event keyed on month and category, so
 * a retry after a failure part-way pays only what is still unpaid.
 */
export async function approveAchievers(v: DgoViewer, monthIn: string, note?: string | null) {
  if (!canApproveAchievers(v)) throw httpError("You can't approve monthly achievers", 403);
  const month = monthOrLast(v, monthIn);
  const doc = await DgoAchieverMonth.findOne({ organization: v.orgId, month }).lean<MonthDoc>();
  if (!doc) throw httpError("Fetch the figures first", 409);
  if (doc.status === "published") return { ...(await view(v, month)), message: "Already published" };
  if (doc.status !== "verified" && doc.status !== "approved") throw httpError("Finance verifies it first", 409);
  await assertMonthOpen(v.orgId, month, "its prizes can't be paid");
  if (String(doc.verifiedBy) === v.userId) {
    await dgoAudit(v, "achievers_refused", "achiever_month", month, null, { reason: "verifier approving" });
    throw httpError("You verified it, so someone else approves", 403);
  }
  const winners = doc.categories.filter((c) => c.winner);
  if (winners.some((c) => c.winner!.employee && v.employee && String(c.winner!.employee) === v.employee._id)) {
    await dgoAudit(v, "achievers_refused", "achiever_month", month, null, { reason: "own prize" });
    throw httpError("You're one of the winners, so someone else approves", 403);
  }
  if (doc.status === "verified") {
    const r = await DgoAchieverMonth.updateOne(
      { _id: doc._id, status: "verified" },
      { $set: { status: "approved", approvedBy: v.userId, approvedByName: v.name }, $push: { trail: trailEntry("approved", v, note?.trim() || null) } }
    );
    if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
  }
  const actor: Actor = { userId: v.userId, name: v.name };
  const failed: string[] = [];
  for (const c of winners) {
    try {
      const eventId = await postPrize(v, doc, c, actor);
      await DgoAchieverMonth.updateOne({ _id: doc._id, "categories.code": c.code }, { $set: { "categories.$.awardEvent": eventId } });
    } catch (e) {
      failed.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  if (failed.length) {
    await DgoAchieverMonth.updateOne({ _id: doc._id }, { $push: { trail: trailEntry("publish_failed", v, failed.join("; ")) } });
    throw httpError(`Approved, but ${failed.length} prize(s) couldn't be paid: ${failed.join("; ")}. Approve again to retry`, 409);
  }
  await DgoAchieverMonth.updateOne(
    { _id: doc._id, status: "approved" },
    { $set: { status: "published", publishedAt: new Date(), publishedByName: v.name }, $push: { trail: trailEntry("published", v, `${winners.length} prize(s) paid`) } }
  );
  await dgoAudit(v, "achievers_published", "achiever_month", month, { status: doc.status }, { status: "published", prizes: winners.map((c) => `${c.code}:${c.winner!.name}:${c.prizePoints}`) });
  return { ...(await view(v, month)), message: `Published — ${winners.length} prize(s) paid` };
}

/** One prize as a posted earning: elite pool first, then the ledger credit. */
async function postPrize(v: DgoViewer, doc: MonthDoc, c: CategoryResult, actor: Actor): Promise<Types.ObjectId> {
  const w = c.winner!;
  if (!w.employee) throw new Error(`${w.name} isn't in HRMS`);
  const key = `ELITE:${v.orgId}:${doc.month}:${c.code}`;
  const found = await DgoEarningEvent.findOne({ idempotencyKey: key }).lean<{ _id: Types.ObjectId; status: string }>();
  if (found?.status === "posted") return found._id;
  const emp = await Employee.findById(w.employee).select("name user department status").lean<{ _id: Types.ObjectId; name: string; user?: unknown; department?: unknown; status: string }>();
  if (!emp) throw new Error(`${w.name} isn't in HRMS any more`);
  const dept = emp.department ? await Department.findById(emp.department).select("name").lean<{ name: string }>() : null;
  const lastDay = new Date(Date.UTC(Number(doc.month.slice(0, 4)), Number(doc.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const settings = await settingsOn(v.orgId, lastDay);
  const valueFils = toFils(c.prizeAed);
  let eventId = found?._id;
  if (!eventId) {
    try {
      const created = await DgoEarningEvent.create({
        organization: v.orgId, employee: emp._id, user: emp.user ?? null, employeeName: emp.name,
        department: emp.department ?? null, departmentName: dept?.name ?? null,
        rule: null, ruleCode: `${ELITE_RULE_PREFIX}${c.code}`, ruleVersion: 1, ruleName: `Monthly achiever: ${c.name} (${doc.month})`,
        source: "award", origin: "elite", points: c.prizePoints, valueFils, capExempt: true,
        day: lastDay, month: doc.month, reason: `${c.name}: ${w.detail ? `${w.detail}, ` : ""}${MENTOR_METRICS.includes(c.metric) ? `score ${w.value}` : aed(w.value)}`,
        status: "pending", chain: [], stage: null,
        trail: [{ stage: null, action: "submitted", by: v.userId, byName: v.name, note: "Monthly achievers approved", at: new Date() }],
        submittedBy: doc.verifiedBy, submittedByName: doc.verifiedByName, idempotencyKey: key,
      });
      eventId = created._id as Types.ObjectId;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      eventId = (await DgoEarningEvent.findOne({ idempotencyKey: key }).select("_id").lean<{ _id: Types.ObjectId }>())!._id;
    }
  }
  const ev = await DgoEarningEvent.findById(eventId).lean<{ _id: Types.ObjectId; organization: unknown; employee: unknown; points: number; day: string; month: string; ruleCode: string; ruleName: string; status: string; user: unknown }>();
  if (!ev) throw new Error("The prize record went missing");
  if (ev.status === "posted") return ev._id;
  if (ev.status !== "pending") throw new Error(`The prize is ${ev.status}`);
  const outcome = await inTransaction(async (session) => {
    const claimed = await DgoEarningEvent.findOneAndUpdate({ _id: ev._id, status: "pending" }, { $set: { status: "posted", postedAt: new Date() } }, { new: true, session });
    if (!claimed) return "already" as const;
    if (!(await commitElite(v.orgId, doc.month, valueFils, session))) {
      // Not paid: back to pending, so approving again retries it.
      await DgoEarningEvent.updateOne({ _id: ev._id }, { $set: { status: "pending", postedAt: null } }, { session });
      return "pool" as const;
    }
    let lotId: Types.ObjectId | null = null;
    try { lotId = await creditEvent(ev, settings.expiryMonths, actor, session); } catch (e) { if (!(e instanceof AlreadyCredited)) throw e; }
    await DgoEarningEvent.updateOne(
      { _id: ev._id },
      { ...(lotId ? { $set: { lot: lotId } } : {}), $push: { trail: { stage: null, action: "posted", by: v.userId, byName: v.name, note: `${ev.points} points from the elite pool`, at: new Date() } } },
      { session }
    );
    return "posted" as const;
  });
  if (outcome === "pool") throw new Error("the elite pool doesn't have enough left");
  if (outcome === "posted") {
    await notify({
      users: [ev.user], kind: "system", tone: "positive", organization: v.orgId, actor: v.userId,
      title: `You're a monthly achiever: ${c.name}`, body: `+${ev.points.toLocaleString("en")} DGO Points for ${doc.month}`, href: `/dgo-points/achievers?month=${doc.month}`,
    });
  }
  return ev._id;
}
