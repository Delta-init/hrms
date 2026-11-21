import type { Types } from "mongoose";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { notify } from "../notificationService.js";
import { ACTIVE_EMPLOYEE_STATUSES, type DgoStage } from "./dgoDefaults.js";
import { capCheck, dayIn, isDay, pointsToFils, previousMonth, toAed } from "./dgoMath.js";
import { httpError, isDuplicateKey } from "./dgoErrors.js";
import { ruleOn, settingsOn } from "./dgoSettingsService.js";
import { budgetRowFor, commitBudget, leftFor, releaseBudget, releaseElite } from "./dgoBudgetService.js";
import { DgoDepartmentBudget } from "../../models/DgoDepartmentBudget.js";
import { programSettings } from "./dgoSettingsService.js";
import { assertMonthOpen } from "./dgoCloseService.js";
import { AlreadyCredited, creditEvent, reverseEvent, type Actor } from "./dgoLedgerService.js";
import { inTransaction } from "./dgoTxn.js";
import { dgoAudit } from "./dgoAudit.js";
import {
  approverUserIds, assertCanUse, can, departmentHasHead, isOpen, oid, whyCannotDecide, whyCannotRecordFor, type DgoViewer,
} from "./dgoAccess.js";

/**
 * Earning points: the handoff's ten steps.
 *
 *  1. ingest with an idempotency key   — `idempotencyKey` is unique; a repeat returns the first
 *  2. validate employee and rule version — active employee, rule in force on the day
 *  3. compute the achievement            — the rule's points (KPI met 20, exceeded 30)
 *  4. duplicates and exclusive awards    — KPI exceeded replaces KPI met, never adds to it
 *  5. the per-employee daily cap         — 50 a day, 30 of them KPI; innovation outside it
 *  6. a pending earning                  — the event, with its chain snapshotted
 *  7. route approval                     — head → HR → finance, as the rule says
 *  8. budget                             — the department's allowance, by conditional increment
 *  9. ledger credit                      — a lot expiring in 12 months
 * 10. notify                             — in-app and push, best-effort
 */

export interface EventDoc {
  _id: Types.ObjectId;
  organization: unknown;
  employee: Types.ObjectId;
  user: unknown;
  employeeName: string;
  department: unknown;
  departmentName: string | null;
  rule: unknown;
  origin?: "recorded" | "nomination" | "elite";
  nominationMonth?: string | null;
  evidenceKey?: string | null;
  evidenceName?: string | null;
  ruleCode: string;
  ruleVersion: number;
  ruleName: string;
  source: "kpi" | "award";
  kpiKey: string | null;
  kpiLevel: "met" | "exceeded" | null;
  points: number;
  valueFils: number;
  capExempt: boolean;
  day: string;
  month: string;
  reason: string;
  evidenceNote: string | null;
  status: "pending" | "posted" | "rejected" | "capped" | "budget_blocked" | "superseded" | "reversed";
  chain: DgoStage[];
  stage: DgoStage | null;
  trail: Array<{ stage: DgoStage | null; action: string; by: unknown; byName: string | null; note: string | null; at: Date }>;
  submittedBy: unknown;
  submittedByName: string | null;
  idempotencyKey: string;
  lot: unknown;
  postedAt: Date | null;
  supersedes: Types.ObjectId | null;
  createdAt: Date;
}

const trailEntry = (stage: DgoStage | null, action: string, v: { userId: string | null; name: string | null }, note: string | null = null) =>
  ({ stage, action, by: v.userId, byName: v.name, note, at: new Date() });

const actorOf = (v: DgoViewer): Actor => ({ userId: v.userId, name: v.name });

/** Points already counted on a day for one person: pending and posted, cap-exempt left out. */
async function usedOn(orgId: string, employee: unknown, day: string, opts: { exclude?: unknown[]; postedOnly?: boolean } = {}) {
  const rows = await DgoEarningEvent.aggregate<{ _id: string; points: number }>([
    {
      $match: {
        organization: oid(orgId), employee: oid(employee), day, capExempt: false,
        status: { $in: opts.postedOnly ? ["posted"] : ["pending", "posted"] },
        ...(opts.exclude?.length ? { _id: { $nin: opts.exclude.filter(Boolean).map(oid) } } : {}),
      },
    },
    { $group: { _id: "$source", points: { $sum: "$points" } } },
  ]);
  const auto = rows.find((r) => r._id === "kpi")?.points ?? 0;
  return { total: rows.reduce((s, r) => s + r.points, 0), auto };
}

export interface RecordInput {
  employeeId: string;
  ruleCode: string;
  day: string;
  reason: string;
  evidenceNote?: string | null;
  kpiKey?: string | null;
  requestId: string;
}

interface EmpDoc { _id: Types.ObjectId; name: string; user?: unknown; department?: unknown; status: string }

async function activeEmployee(v: DgoViewer, employeeId: string): Promise<EmpDoc> {
  const emp = await Employee.findOne({ _id: employeeId, organization: v.orgId })
    .select("name user department status")
    .lean<EmpDoc>();
  if (!emp) throw httpError("That employee isn't in this organisation", 404);
  if (!ACTIVE_EMPLOYEE_STATUSES.includes(emp.status)) throw httpError(`${emp.name} has left, so can't earn points`, 400);
  return emp;
}

/** Record points for somebody: a department head for their team, HR for anyone. */
export async function recordEarning(v: DgoViewer, input: RecordInput): Promise<{ event: EventDoc; duplicate: boolean; message: string }> {
  const emp = await activeEmployee(v, input.employeeId);
  const open = await isOpen(v.orgId);
  const refused = whyCannotRecordFor(v, emp, open);
  if (refused) throw httpError(refused, 403);
  return createEvent(v, emp, open, input, { origin: "recorded" });
}

export interface NominateInput {
  employeeId: string;
  ruleCode: string;
  day: string;
  reason: string;
  evidenceNote?: string | null;
  evidenceKey?: string | null;
  evidenceName?: string | null;
  requestId: string;
}

/**
 * A colleague nominating somebody for a recognition award. It becomes an
 * earning request like any other — the nominee's department head, then HR, then
 * finance where the rule says — and is paid inside the daily cap and the
 * department's allowance once the last step approves. A limited number a month
 * per person; never yourself; never the same person, award and day twice.
 */
export async function nominate(v: DgoViewer, input: NominateInput): Promise<{ event: EventDoc; duplicate: boolean; message: string }> {
  await assertCanUse(v);
  if (!v.employee) throw httpError("Your login has no employee record, so it can't nominate anyone", 403);
  const key = `NOMINATION:${v.orgId}:${input.requestId}`;
  const existing = await DgoEarningEvent.findOne({ idempotencyKey: key }).lean<EventDoc>();
  if (existing) return { event: existing, duplicate: true, message: "Already sent" };
  const emp = await activeEmployee(v, input.employeeId);
  if (String(emp._id) === v.employee._id || (emp.user && String(emp.user) === v.userId)) {
    await dgoAudit(v, "nomination_refused", "employee", emp._id, null, { reason: "self-nomination" });
    throw httpError("You can't nominate yourself", 403);
  }
  const rule = await ruleOn(v.orgId, input.ruleCode, isDay(input.day) ? input.day : dayIn(v.tz));
  if (rule && rule.source !== "award") throw httpError("KPI points come from the daily KPI, not from a nomination", 400);
  const today = dayIn(v.tz);
  const month = today.slice(0, 7);
  const program = await programSettings(v.orgId);
  const used = await DgoEarningEvent.countDocuments({ organization: v.orgId, submittedBy: oid(v.userId), origin: "nomination", nominationMonth: month });
  if (used >= program.nominationsPerMonth) {
    throw httpError(program.nominationsPerMonth === 0
      ? "Nominations are switched off"
      : `You've used all ${program.nominationsPerMonth} of your nominations for this month`, 409);
  }
  const again = await DgoEarningEvent.exists({
    organization: v.orgId, submittedBy: oid(v.userId), origin: "nomination", employee: emp._id,
    ruleCode: input.ruleCode.toUpperCase(), day: input.day, status: { $in: ["pending", "posted"] },
  });
  if (again) throw httpError(`You've already nominated ${emp.name} for this on ${input.day}`, 409);
  const evidenceKey = input.evidenceKey?.trim() || null;
  if (evidenceKey && !evidenceKey.startsWith(`${v.orgId}/dgo-evidence/${v.userId}/`)) throw httpError("Upload the file again", 400);
  const open = await isOpen(v.orgId);
  return createEvent(v, emp, open, { ...input, kpiKey: null }, {
    origin: "nomination", key, nominationMonth: month, evidenceKey, evidenceName: input.evidenceName?.trim() || null,
  });
}

/** The steps a nomination goes through: the department head and HR always, finance when the rule asks for it. */
export const nominationChain = (ruleChain: DgoStage[]): DgoStage[] =>
  (["head", "hr", "finance"] as DgoStage[]).filter((s) => s === "head" || s === "hr" || ruleChain.includes(s));

interface CreateOpts {
  origin: "recorded" | "nomination";
  key?: string;
  nominationMonth?: string;
  evidenceKey?: string | null;
  evidenceName?: string | null;
}

/** Steps 2–7 for a request somebody may make: validate, de-duplicate, cap, chain, then post or route for approval. */
async function createEvent(
  v: DgoViewer, emp: EmpDoc, open: boolean, input: RecordInput, opts: CreateOpts,
): Promise<{ event: EventDoc; duplicate: boolean; message: string }> {
  const today = dayIn(v.tz);
  if (!isDay(input.day) || input.day > today) throw httpError("Pick today or an earlier day", 400);
  const month = input.day.slice(0, 7);
  if (month < previousMonth(today.slice(0, 7))) throw httpError("Points can be recorded for this month or last month only", 400);
  await assertMonthOpen(v.orgId, month, "nothing more can be recorded for it");
  const settings = await settingsOn(v.orgId, input.day);
  const rule = await ruleOn(v.orgId, input.ruleCode, input.day);
  if (!rule) throw httpError(`${input.ruleCode} isn't in force on ${input.day}`, 400);
  if (rule.needsEvidence && !input.evidenceNote?.trim() && !opts.evidenceKey) {
    throw httpError(`${rule.name} needs evidence: say what shows it happened${opts.origin === "nomination" ? " or attach a file" : ""}`, 400);
  }
  if (!input.reason?.trim()) throw httpError("Say what it was for", 400);

  const kpiKey = rule.source === "kpi" ? (input.kpiKey?.trim().toLowerCase() || "daily") : null;
  const key = opts.key ?? (rule.source === "kpi"
    ? `KPI:${emp._id}:${kpiKey}:${input.day}:${rule.kpiLevel}`
    : `AWARD:${v.orgId}:${input.requestId}`);
  const existing = await DgoEarningEvent.findOne({ idempotencyKey: key }).lean<EventDoc>();
  if (existing) return { event: existing, duplicate: true, message: "Already recorded" };

  // Step 4: one KPI award per person, KPI and day. Exceeded replaces met; met after exceeded is refused.
  let supersedes: EventDoc | null = null;
  if (rule.source === "kpi") {
    const other = await DgoEarningEvent.findOne({
      organization: v.orgId, employee: emp._id, source: "kpi", kpiKey, day: input.day, status: { $in: ["pending", "posted"] },
    }).lean<EventDoc>();
    if (other) {
      if (other.kpiLevel === "exceeded" || rule.kpiLevel !== "exceeded") {
        throw httpError(`Already recorded as ${other.ruleName} for ${input.day}`, 409);
      }
      supersedes = other;
    }
  }

  // Step 5: the daily cap, counting what is pending too — a replaced KPI award does not count.
  const used = await usedOn(v.orgId, emp._id, input.day, { exclude: supersedes ? [supersedes._id] : [] });
  const cap = capCheck({
    usedTotal: used.total, usedAuto: used.auto, points: rule.points, isAuto: rule.source === "kpi",
    capExempt: rule.capExempt, dailyCap: settings.dailyCap, autoCap: settings.autoKpiCap,
  });

  // Step 7: the chain. A department with no head goes straight to HR; a head recording for their own team has done the head's step.
  // A nomination always passes the nominee's head and HR, whatever the rule's own chain (finance too when the rule says).
  let chain: DgoStage[] = opts.origin === "nomination" ? nominationChain(rule.chain) : [...rule.chain];
  const trail = [trailEntry(null, "submitted", v)];
  if (chain.includes("head")) {
    if (!open) {
      // Heads see nothing until DGO Points opens, so nothing can wait on one.
      chain = chain.filter((s) => s !== "head");
      trail.push(trailEntry("head", "skipped", { userId: null, name: null }, "DGO Points isn't open to departments yet, so HR decides"));
    } else if (!(await departmentHasHead(emp.department))) {
      chain = chain.filter((s) => s !== "head");
      trail.push(trailEntry("head", "skipped", { userId: null, name: null }, "No department head set, so HR decides"));
    } else if (emp.department && v.headOf.includes(String(emp.department))) {
      chain = chain.filter((s) => s !== "head");
      trail.push(trailEntry("head", "approved", v, "Recorded by the department head"));
    }
  }
  if (!cap.ok) trail.push(trailEntry(null, "capped", { userId: null, name: null }, cap.reason));

  const department = emp.department ? await Department.findById(emp.department).select("name").lean<{ name: string }>() : null;
  let created: EventDoc;
  try {
    const doc = await DgoEarningEvent.create({
      organization: v.orgId, employee: emp._id, user: emp.user ?? null, employeeName: emp.name,
      department: emp.department ?? null, departmentName: department?.name ?? null,
      rule: rule._id, ruleCode: rule.code, ruleVersion: rule.version, ruleName: rule.name,
      source: rule.source, kpiKey, kpiLevel: rule.kpiLevel ?? null,
      origin: opts.origin, nominationMonth: opts.nominationMonth ?? null,
      evidenceKey: opts.evidenceKey ?? null, evidenceName: opts.evidenceName ?? null,
      points: rule.points, valueFils: pointsToFils(rule.points, settings.pointValueAed), capExempt: rule.capExempt,
      day: input.day, month, reason: input.reason.trim(), evidenceNote: input.evidenceNote?.trim() || null,
      status: cap.ok ? "pending" : "capped", chain, stage: cap.ok ? chain[0] ?? null : null, trail,
      submittedBy: v.userId, submittedByName: v.name, idempotencyKey: key, supersedes: supersedes?._id ?? null,
    });
    created = doc.toObject() as unknown as EventDoc;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    const again = await DgoEarningEvent.findOne({ idempotencyKey: key }).lean<EventDoc>();
    if (again) return { event: again, duplicate: true, message: "Already recorded" };
    // A KPI award for the other level got in at the same moment.
    throw httpError("Recorded by someone else at the same moment — refresh", 409);
  }
  await dgoAudit(v, opts.origin === "nomination" ? "nomination_sent" : "earning_recorded", "earning_event", created._id, null, { employee: emp.name, rule: rule.code, points: rule.points, day: input.day, status: created.status });

  if (!cap.ok) return { event: created, duplicate: false, message: `Not counted: ${cap.reason}` };
  // A KPI exceeded recorded while the met is still waiting: the met will never be paid.
  if (supersedes && supersedes.status === "pending") {
    await DgoEarningEvent.updateOne(
      { _id: supersedes._id, status: "pending" },
      { $set: { status: "superseded", stage: null }, $push: { trail: trailEntry(null, "superseded", v, `Replaced by ${rule.name}`) } }
    );
  }
  if (!chain.length) {
    const posted = await postEvent(actorOf(v), created._id);
    return { event: posted, duplicate: false, message: posted.status === "posted" ? `${rule.points} points credited` : messageFor(posted) };
  }
  await tellApprovers(v.orgId, created);
  return { event: created, duplicate: false, message: `Sent for approval: ${stageName(chain[0])}` };
}

/** Tell finance when a department's allowance for the month passes 80%, 90% or 100%. Best-effort. */
async function budgetAlert(orgId: string, rowId: Types.ObjectId, addedFils: number, releasedFils: number) {
  try {
    const row = await DgoDepartmentBudget.findById(rowId).lean<{ departmentName: string; allocationFils: number; committedFils: number; month: string }>();
    if (!row || row.allocationFils <= 0) return;
    const now = row.committedFils;
    const before = now - addedFils + releasedFils;
    const crossed = [100, 90, 80].find((p) => before * 100 < p * row.allocationFils && now * 100 >= p * row.allocationFils);
    if (!crossed) return;
    const finance = await approverUserIds(orgId, "finance", null).catch(() => []);
    await notify({
      users: finance, kind: "system", tone: crossed === 100 ? "negative" : "neutral", organization: orgId,
      title: `${row.departmentName}'s DGO allowance is ${crossed}% used`,
      body: `AED ${toAed(now).toFixed(2)} of ${toAed(row.allocationFils).toFixed(2)}${crossed === 100 ? " — nothing more can be paid this month" : ""}`,
      href: "/dgo-points/budgets",
    });
  } catch { /* an alert never stops a payment */ }
}

const stageName = (s: DgoStage | null) => (s === "head" ? "department head" : s === "hr" ? "HR" : s === "finance" ? "finance" : "posting");

function messageFor(ev: EventDoc): string {
  const last = ev.trail[ev.trail.length - 1];
  if (ev.status === "budget_blocked") return `Approved, but not paid: ${last?.note ?? "the department's allowance is used up"}`;
  if (ev.status === "capped") return `Approved, but not paid: ${last?.note ?? "over the daily cap"}`;
  return ev.status;
}

async function tellApprovers(orgId: string, ev: EventDoc) {
  const users = await approverUserIds(orgId, ev.stage, ev.user).catch(() => []);
  await notify({
    users, kind: "approval", organization: orgId,
    title: `DGO Points to approve: ${ev.ruleName} for ${ev.employeeName}`,
    body: `${ev.points} points · ${ev.day}`,
    href: "/dgo-points/approvals",
  });
}

/**
 * Steps 8–10 for an event every approver has passed: re-check the cap against
 * what is actually posted, take the budget, credit the ledger, and tell the
 * employee. One transaction where the database allows; otherwise each write is
 * guarded so a repeat or a crash cannot pay twice.
 */
export async function postEvent(actor: Actor, eventId: Types.ObjectId): Promise<EventDoc> {
  const ev = await DgoEarningEvent.findById(eventId).lean<EventDoc>();
  if (!ev) throw httpError("That request no longer exists", 404);
  if (ev.status !== "pending") return ev;
  if (ev.origin === "elite") throw httpError("Monthly achiever prizes are paid from the elite pool, on the Monthly Achievers page", 409);
  const orgId = String(ev.organization);
  const settings = await settingsOn(orgId, ev.day);
  const { period, rowId } = await budgetRowFor(orgId, ev.month, ev.department);
  const hold = async (status: "capped" | "budget_blocked", note: string) => {
    await DgoEarningEvent.updateOne({ _id: ev._id, status: "pending" }, { $set: { status, stage: null }, $push: { trail: trailEntry(null, status, { userId: null, name: null }, note) } });
  };
  if (period.status === "closed") {
    await hold("budget_blocked", `${ev.month} is closed`);
    return (await DgoEarningEvent.findById(ev._id).lean<EventDoc>())!;
  }
  const replaced = ev.supersedes ? await DgoEarningEvent.findById(ev.supersedes).lean<EventDoc>() : null;
  const used = await usedOn(orgId, ev.employee, ev.day, { exclude: [ev._id, replaced?._id], postedOnly: true });
  const cap = capCheck({
    usedTotal: used.total, usedAuto: used.auto, points: ev.points, isAuto: ev.source === "kpi",
    capExempt: ev.capExempt, dailyCap: settings.dailyCap, autoCap: settings.autoKpiCap,
  });
  if (!cap.ok) {
    await hold("capped", cap.reason);
    return (await DgoEarningEvent.findById(ev._id).lean<EventDoc>())!;
  }

  const outcome = await inTransaction(async (session) => {
    // Claim the event first: only one caller gets past this line.
    const claimed = await DgoEarningEvent.findOneAndUpdate(
      { _id: ev._id, status: "pending" },
      { $set: { status: "posted", stage: null, postedAt: new Date() } },
      { new: true, session }
    );
    if (!claimed) return "already" as const;
    // A posted KPI met being replaced gives its money back before the exceeded takes its own.
    if (replaced?.status === "posted") {
      await releaseBudget(orgId, replaced.month, replaced.department, replaced.valueFils, session);
    }
    if (!(await commitBudget(rowId, ev.valueFils, session))) {
      if (replaced?.status === "posted") await commitBudget(rowId, replaced.valueFils, session);
      const left = await leftFor(orgId, ev.month, ev.department);
      await DgoEarningEvent.updateOne(
        { _id: ev._id },
        { $set: { status: "budget_blocked", postedAt: null }, $push: { trail: trailEntry(null, "budget_blocked", { userId: null, name: null }, `${left?.name ?? "The department"}'s allowance for ${ev.month} is used up (AED ${toAed(Math.max(0, left?.leftFils ?? 0)).toFixed(2)} left)`) } },
        { session }
      );
      return "budget" as const;
    }
    let lotId: Types.ObjectId | null = null;
    try {
      lotId = await creditEvent(ev, settings.expiryMonths, actor, session);
    } catch (e) {
      if (!(e instanceof AlreadyCredited)) throw e;
    }
    await DgoEarningEvent.updateOne(
      { _id: ev._id },
      { ...(lotId ? { $set: { lot: lotId } } : {}), $push: { trail: trailEntry(null, "posted", actor, `${ev.points} points credited`) } },
      { session }
    );
    if (replaced?.status === "posted") {
      // Dated on the KPI's own day, so the month shows 30 for it, not 50 then −20.
      await reverseEvent(replaced, ev.day, "Replaced by KPI exceeded", actor, session);
      await DgoEarningEvent.updateOne(
        { _id: replaced._id },
        { $set: { status: "superseded" }, $push: { trail: trailEntry(null, "superseded", actor, `Replaced by ${ev.ruleName}: ${ev.points} points in its place`) } },
        { session }
      );
    }
    return "posted" as const;
  });

  const after = (await DgoEarningEvent.findById(ev._id).lean<EventDoc>())!;
  if (outcome === "posted") {
    await notify({
      users: [ev.user], kind: "system", tone: "positive", organization: orgId, actor: actor.userId,
      title: `+${ev.points} DGO Points`,
      body: ev.origin === "nomination" ? `${ev.ruleName} · nominated by ${ev.submittedByName ?? "a colleague"}` : `${ev.ruleName} · ${ev.day}`,
      href: "/dgo-points/wallet",
    });
    if (ev.origin === "nomination" && ev.submittedBy) {
      await notify({
        users: [ev.submittedBy], kind: "system", tone: "positive", organization: orgId, actor: actor.userId,
        title: `Your nomination of ${ev.employeeName} was approved`, body: `${ev.ruleName} · ${ev.points} points`, href: "/dgo-points/nominations",
      });
    }
    await budgetAlert(orgId, rowId, ev.valueFils, replaced?.status === "posted" ? replaced.valueFils : 0);
  } else if (outcome === "budget") {
    const finance = await approverUserIds(orgId, "finance", null).catch(() => []);
    await notify({
      users: [...finance, ev.submittedBy], kind: "system", tone: "negative", organization: orgId,
      title: `DGO Points not paid: ${ev.departmentName ?? "a department"}'s allowance is used up`,
      body: `${ev.ruleName} for ${ev.employeeName}, ${ev.points} points`, href: "/dgo-points/budgets",
    });
  }
  return after;
}

/** Approve or reject the step a request is waiting at. Repeat-safe: the same click twice decides once. */
export async function decide(v: DgoViewer, eventId: string, approve: boolean, note?: string | null): Promise<{ event: EventDoc; message: string }> {
  const ev = await DgoEarningEvent.findOne({ _id: eventId, organization: v.orgId }).lean<EventDoc>();
  if (!ev) throw httpError("That request no longer exists", 404);
  if (ev.status !== "pending") {
    const mine = [...ev.trail].reverse().find((t) => String(t.by) === v.userId && (t.action === "approved" || t.action === "rejected"));
    if (mine) return { event: ev, message: "Already done" };
    throw httpError(`Already decided: ${ev.status.replace("_", " ")}`, 409);
  }
  if (ev.origin === "elite") throw httpError("Monthly achiever prizes are paid from the Monthly Achievers page", 409);
  const why = whyCannotDecide(v, ev);
  // A second click landing after the first moved it on: report the first, don't refuse.
  const lastDecision = [...ev.trail].reverse().find((t) => t.action === "approved" || t.action === "rejected");
  if (why && lastDecision && String(lastDecision.by) === v.userId) return { event: ev, message: "Already done" };
  if (why) {
    // A self-approval is refused and recorded; somebody merely at the wrong step is just told.
    if (/for you|You recorded/.test(why)) {
      await dgoAudit(v, "approval_refused", "earning_event", ev._id, null, { reason: why, stage: ev.stage });
    }
    throw httpError(why, 403);
  }
  if (!approve && !note?.trim()) throw httpError("Say why you're rejecting it", 400);

  const stage = ev.stage;
  if (stage === null) {
    // Approved by everyone already, but posting failed part-way: finance posts it again.
    const posted = await postEvent(actorOf(v), ev._id);
    return { event: posted, message: posted.status === "posted" ? "Posted" : messageFor(posted) };
  }
  if (!approve) {
    const r = await DgoEarningEvent.findOneAndUpdate(
      { _id: ev._id, status: "pending", stage },
      { $set: { status: "rejected", stage: null }, $push: { trail: trailEntry(stage, "rejected", v, note!.trim()) } },
      { new: true }
    ).lean<EventDoc>();
    if (!r) return { event: (await DgoEarningEvent.findById(ev._id).lean<EventDoc>())!, message: "Already decided" };
    await dgoAudit(v, "earning_rejected", "earning_event", ev._id, { status: "pending", stage }, { status: "rejected", note });
    await notify({
      users: [ev.submittedBy], kind: "approval", tone: "negative", organization: v.orgId, actor: v.userId,
      title: ev.origin === "nomination" ? `Your nomination of ${ev.employeeName} wasn't approved` : `DGO Points not approved: ${ev.ruleName} for ${ev.employeeName}`,
      body: note!.trim(), href: ev.origin === "nomination" ? "/dgo-points/nominations" : "/dgo-points/approvals",
    });
    return { event: r, message: "Rejected" };
  }
  const next = ev.chain[ev.chain.indexOf(stage) + 1] ?? null;
  const r = await DgoEarningEvent.findOneAndUpdate(
    { _id: ev._id, status: "pending", stage },
    { $set: { stage: next }, $push: { trail: trailEntry(stage, "approved", v, note?.trim() || null) } },
    { new: true }
  ).lean<EventDoc>();
  if (!r) return { event: (await DgoEarningEvent.findById(ev._id).lean<EventDoc>())!, message: "Already decided" };
  await dgoAudit(v, "earning_approved", "earning_event", ev._id, { stage }, { stage: next });
  if (next) {
    await tellApprovers(v.orgId, r);
    return { event: r, message: `Approved — now with ${stageName(next)}` };
  }
  const posted = await postEvent(actorOf(v), ev._id);
  return { event: posted, message: posted.status === "posted" ? `Approved — ${ev.points} points credited` : messageFor(posted) };
}

/** Take back points already credited (finance): a reversal row, the allowance given back, the employee told. */
export async function reverseEarning(v: DgoViewer, eventId: string, reason: string): Promise<EventDoc> {
  if (!can(v, "dgoBudgets", "edit")) throw httpError("Only finance can take points back", 403);
  if (!reason?.trim()) throw httpError("Say why the points are taken back", 400);
  const ev = await DgoEarningEvent.findOne({ _id: eventId, organization: v.orgId }).lean<EventDoc>();
  if (!ev) throw httpError("That request no longer exists", 404);
  if (ev.status === "reversed") return ev;
  if (ev.status !== "posted") throw httpError("Only credited points can be taken back", 409);
  if ((v.employee && v.employee._id === String(ev.employee)) || String(ev.user) === v.userId) {
    await dgoAudit(v, "reversal_refused", "earning_event", ev._id, null, { reason: "own points" });
    throw httpError("These points are yours, so someone else takes them back", 403);
  }
  const today = dayIn(v.tz);
  await inTransaction(async (session) => {
    const claimed = await DgoEarningEvent.findOneAndUpdate(
      { _id: ev._id, status: "posted" },
      { $set: { status: "reversed", reversedAt: new Date() }, $push: { trail: trailEntry(null, "reversed", v, reason.trim()) } },
      { new: true, session }
    );
    if (!claimed) return;
    await reverseEvent(ev, today, "Taken back", actorOf(v), session);
    if (ev.origin === "elite") await releaseElite(v.orgId, ev.month, ev.valueFils, session);
    else await releaseBudget(v.orgId, ev.month, ev.department, ev.valueFils, session);
  });
  await dgoAudit(v, "earning_reversed", "earning_event", ev._id, { status: "posted" }, { status: "reversed", reason: reason.trim() });
  await notify({ users: [ev.user], kind: "system", tone: "negative", organization: v.orgId, actor: v.userId, title: `−${ev.points} DGO Points`, body: `${ev.ruleName} (${ev.day}) taken back: ${reason.trim()}`, href: "/dgo-points/wallet" });
  return (await DgoEarningEvent.findById(ev._id).lean<EventDoc>())!;
}
