import type { Types } from "mongoose";
import { DgoSyncRun } from "../../models/DgoSyncRun.js";
import { DgoSuggestion } from "../../models/DgoSuggestion.js";
import { DgoProgram } from "../../models/DgoProgram.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { User } from "../../models/User.js";
import { Organization } from "../../models/Organization.js";
import { ACTIVE_EMPLOYEE_STATUSES } from "./dgoDefaults.js";
import { dayIn, isDay, previousMonth } from "./dgoMath.js";
import { httpError } from "./dgoErrors.js";
import { settingsOn } from "./dgoSettingsService.js";
import { recordAutomaticKpi } from "./dgoEarningService.js";
import { askRoot } from "./dgoRootClient.js";
import { audienceOf, can, inAudience, isOpen, systemViewer, type DgoViewer } from "./dgoAccess.js";

/**
 * Sales KPI points from Root's daily tracker (Phase 4).
 *
 * Root says, for a Dubai day, each salesperson's achieved % — the average of
 * their tracker metrics against their share of the team's target, each metric
 * capped at 200%. 100% or more is KPI met (20 points), at least the settings'
 * "exceeded" % (120) is KPI exceeded (30). Paid as a KPI day recorded by
 * "Root daily tracker": the same key a head recording it by hand would use, so
 * a day pays once; exceeded replaces met; the cap and the department's
 * allowance apply; a closed month refuses. Points are never taken back when a
 * later re-check shows less.
 *
 * The same answer carries the day's verified 5-star LMS reviews with a
 * comment, which become Student feedback suggestions for the mentor's head or
 * HR to record.
 */

export interface RootKpiFacts {
  date: string;
  people: Array<{ email: string; name: string; crm: string; achievedPct: number; score: number; metrics?: unknown[] }>;
  reviews: Array<{ id: string; mentorEmail: string; mentorName: string; rating: number; comment: string; className: string | null; studentName: string | null; at: string }>;
  problems: string[];
}

type Fetcher = (day: string) => Promise<RootKpiFacts>;
const askRootDay: Fetcher = (day) => askRoot<RootKpiFacts>(`kpi-facts?date=${encodeURIComponent(day)}`, 60_000);
let fetcher: Fetcher = askRootDay;
/** The check script stands Root in with fake figures. */
export const setKpiFetcherForTest = (f: Fetcher | null) => { fetcher = f ?? askRootDay; };

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Addresses matched to this organisation's current employees: work email first, then login email. */
async function matchEmails(orgId: string, emails: string[]) {
  const set = [...new Set(emails.map(lower).filter(Boolean))];
  const out = new Map<string, { _id: Types.ObjectId; name: string; department?: unknown }>();
  if (!set.length) return out;
  const users = await User.find({ email: { $in: set } }).select("_id email").lean<Array<{ _id: unknown; email: string }>>();
  const loginOf = new Map(users.map((u) => [String(u._id), lower(u.email)]));
  const emps = await Employee.find({
    organization: orgId, status: { $in: ACTIVE_EMPLOYEE_STATUSES },
    $or: [{ email: { $in: set } }, ...(users.length ? [{ user: { $in: users.map((u) => u._id) } }] : [])],
  }).select("_id name email user department").lean<Array<{ _id: Types.ObjectId; name: string; email?: string; user?: unknown; department?: unknown }>>();
  for (const e of emps) { const w = lower(e.email); if (w && set.includes(w) && !out.has(w)) out.set(w, e); }
  for (const e of emps) { const l = e.user ? loginOf.get(String(e.user)) : undefined; if (l && !out.has(l)) out.set(l, e); }
  return out;
}

export interface KpiRunResult { runId: string; message: string; ok: boolean; counts: Record<string, number> }

/**
 * Import one Dubai day for one organisation. `trigger` and `by` only say who
 * asked; the work is the same, and repeat-safe.
 */
export async function importKpiDay(orgId: string, day: string, opts: { trigger: "nightly" | "manual"; by?: { userId: string; name: string } }): Promise<KpiRunResult> {
  const org = await Organization.findById(orgId).select("timeZone").lean<{ timeZone?: string }>();
  const tz = org?.timeZone || "Asia/Dubai";
  const run = await DgoSyncRun.create({
    organization: orgId, source: "kpi", key: day, trigger: opts.trigger, by: opts.by?.userId ?? null, byName: opts.by?.name ?? null, startedAt: new Date(),
  });
  const counts: Record<string, number> = { facts: 0, awarded: 0, alreadyThere: 0, belowTarget: 0, notInHrms: 0, notInPilot: 0, monthClosed: 0, capped: 0, budgetBlocked: 0, suggestions: 0 };
  const unmatched: Array<{ email: string; name: string; crm: string | null; achievedPct: number | null; why: string }> = [];
  const errors: string[] = [];
  let problems: string[] = [];
  try {
    const facts = await fetcher(day);
    problems = facts.problems ?? [];
    const settings = await settingsOn(orgId, day);
    const audience = await audienceOf(orgId);
    const sys = systemViewer(orgId, tz, "Root daily tracker");
    const matched = await matchEmails(orgId, [...(facts.people ?? []).map((p) => p.email), ...(facts.reviews ?? []).map((r) => r.mentorEmail)]);

    // One line per person: the best result if they sell in more than one CRM.
    const best = new Map<string, RootKpiFacts["people"][number]>();
    for (const p of facts.people ?? []) {
      const k = lower(p.email);
      if (!k) continue;
      const cur = best.get(k);
      if (!cur || (Number(p.achievedPct) || 0) > (Number(cur.achievedPct) || 0)) best.set(k, p);
    }
    counts.facts = best.size;
    for (const [email, p] of best) {
      const pct = Number(p.achievedPct) || 0;
      if (pct < 100) { counts.belowTarget++; continue; }
      const emp = matched.get(email);
      if (!emp) { counts.notInHrms++; unmatched.push({ email, name: p.name, crm: p.crm ?? null, achievedPct: pct, why: "Not found in HRMS" }); continue; }
      if (!inAudience(audience, emp)) { counts.notInPilot++; unmatched.push({ email, name: emp.name, crm: p.crm ?? null, achievedPct: pct, why: "Not in the DGO Points pilot" }); continue; }
      const level = pct >= settings.kpiExceededPct ? "exceeded" : "met";
      try {
        const out = await recordAutomaticKpi(sys, String(emp._id), level, day, `Daily tracker ${pct.toFixed(1)}% (${p.crm})`);
        if (out.duplicate) counts.alreadyThere++;
        else if (out.event.status === "posted") counts.awarded++;
        else if (out.event.status === "capped") counts.capped++;
        else if (out.event.status === "budget_blocked") counts.budgetBlocked++;
        else counts.alreadyThere++;
      } catch (e) {
        const m = (e as Error).message;
        if (/Already recorded as/.test(m)) counts.alreadyThere++;
        else if (/is closed|being closed/.test(m)) { counts.monthClosed++; }
        else { errors.push(`${emp.name}: ${m}`); unmatched.push({ email, name: emp.name, crm: p.crm ?? null, achievedPct: pct, why: m }); }
      }
    }

    // Student feedback suggestions, one per review.
    const rule = (await (await import("./dgoSettingsService.js")).rulesOn(orgId, day)).find((r) => r.active && r.code === "STUDENT_FEEDBACK");
    if (rule) {
      const deptIds = [...new Set([...matched.values()].map((e) => e.department).filter(Boolean).map(String))];
      const depts = deptIds.length ? await Department.find({ _id: { $in: deptIds } }).select("name").lean<Array<{ _id: unknown; name: string }>>() : [];
      const dname = new Map(depts.map((d) => [String(d._id), d.name]));
      for (const r of facts.reviews ?? []) {
        if (!(r.rating >= 5) || !String(r.comment ?? "").trim()) continue;
        const emp = matched.get(lower(r.mentorEmail));
        if (!emp || !inAudience(audience, emp)) continue;
        const res = await DgoSuggestion.updateOne(
          { organization: orgId, source: "lms_review", sourceId: String(r.id) },
          {
            $setOnInsert: {
              organization: orgId, source: "lms_review", sourceId: String(r.id), employee: emp._id, employeeName: emp.name,
              department: emp.department ?? null, departmentName: emp.department ? dname.get(String(emp.department)) ?? null : null,
              ruleCode: rule.code, day,
              title: `${r.rating}★ review${r.studentName ? ` from ${r.studentName}` : ""}${r.className ? ` — ${r.className}` : ""}`.slice(0, 200),
              detail: String(r.comment).trim().slice(0, 2000), status: "open",
            },
          },
          { upsert: true }
        ).catch((e: { code?: number }) => { if (e.code !== 11000) throw e; return { upsertedCount: 0 }; });
        if ((res as { upsertedCount?: number }).upsertedCount) counts.suggestions++;
      }
    }
    await DgoSyncRun.updateOne({ _id: run._id }, { $set: { finishedAt: new Date(), ok: errors.length === 0, counts, unmatched: unmatched.slice(0, 200), errors, problems } });
  } catch (e) {
    errors.push((e as Error).message);
    await DgoSyncRun.updateOne({ _id: run._id }, { $set: { finishedAt: new Date(), ok: false, counts, unmatched: unmatched.slice(0, 200), errors, problems } });
    if (opts.trigger === "manual") throw e;
  }
  const bits = [
    `${counts.awarded} paid`,
    counts.alreadyThere && `${counts.alreadyThere} already had it`,
    counts.belowTarget && `${counts.belowTarget} under target`,
    counts.notInHrms && `${counts.notInHrms} not found in HRMS`,
    counts.notInPilot && `${counts.notInPilot} not in the pilot`,
    counts.capped && `${counts.capped} over the daily cap`,
    counts.budgetBlocked && `${counts.budgetBlocked} over the department's allowance`,
    counts.monthClosed && `${counts.monthClosed} in a closed month`,
    counts.suggestions && `${counts.suggestions} new review suggestion${counts.suggestions === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return { runId: String(run._id), ok: errors.length === 0, counts, message: `${day}: ${bits.join(", ")}` };
}

/** The nightly run: today and yesterday (late changes can lift a met to an exceeded), for every open organisation. */
export async function importKpiNightly(now = new Date()): Promise<KpiRunResult[]> {
  const orgs = await DgoProgram.find({ openToEmployees: true }).select("organization").lean<Array<{ organization: unknown }>>();
  const out: KpiRunResult[] = [];
  for (const o of orgs) {
    if (!o.organization) continue;
    const orgId = String(o.organization);
    const org = await Organization.findById(orgId).select("timeZone").lean<{ timeZone?: string }>();
    const today = dayIn(org?.timeZone || "Asia/Dubai", now);
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    for (const day of [yesterday, today]) {
      try { out.push(await importKpiDay(orgId, day, { trigger: "nightly" })); }
      catch (e) { console.error(`dgo kpi import ${orgId} ${day}:`, e instanceof Error ? e.message : e); }
    }
  }
  return out;
}

/** POST /dgo-points/integrations/kpi/run — an admin re-runs a day. */
export async function runKpiByHand(v: DgoViewer, day: string) {
  if (!can(v, "dgoSettings", "edit")) throw httpError("You can't run the KPI import", 403);
  const today = dayIn(v.tz);
  if (!isDay(day) || day > today) throw httpError("Pick today or an earlier day", 400);
  if (day.slice(0, 7) < previousMonth(today.slice(0, 7))) throw httpError("Pick a day this month or last month", 400);
  if (!(await isOpen(v.orgId))) throw httpError("DGO Points isn't open yet, so no KPI points are paid", 409);
  return importKpiDay(v.orgId, day, { trigger: "manual", by: { userId: v.userId, name: v.name } });
}
