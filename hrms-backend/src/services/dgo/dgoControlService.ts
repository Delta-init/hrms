import type { Types } from "mongoose";
import { DgoAdjustment } from "../../models/DgoAdjustment.js";
import { DgoBudgetOverride } from "../../models/DgoBudgetOverride.js";
import { DgoDepartmentBudget } from "../../models/DgoDepartmentBudget.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { notify } from "../notificationService.js";
import { dayIn, isMonth, toAed, toFils } from "./dgoMath.js";
import { httpError, isDuplicateKey } from "./dgoErrors.js";
import { settingsOn } from "./dgoSettingsService.js";
import { ensurePeriod } from "./dgoBudgetService.js";
import { addPoints, removePoints, type Actor } from "./dgoLedgerService.js";
import { inTransaction } from "./dgoTxn.js";
import { dgoAudit } from "./dgoAudit.js";
import { assertMonthOpen, overrideDto, whyCannotDecideOverride, type OverrideDoc } from "./dgoCloseService.js";
import { can, isObjectId, usersWith, type DgoViewer } from "./dgoAccess.js";

/**
 * The two controls that need two finance people: a manual adjustment of
 * somebody's points, and a different allowance for a department this month.
 * One proposes, another approves; nobody approves their own proposal or an
 * adjustment of their own points. Both are audited either way.
 */

const actorOf = (v: DgoViewer): Actor => ({ userId: v.userId, name: v.name });
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/* ───────────── Adjustments ───────────── */

interface AdjustmentDoc {
  _id: Types.ObjectId; organization: unknown; employee: Types.ObjectId; user: unknown; employeeName: string; departmentName: string | null;
  points: number; reason: string; status: "pending" | "approved" | "rejected";
  proposedBy: unknown; proposedByName: string | null; createdAt: Date;
  decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null;
}

function whyCannotDecideAdjustment(v: DgoViewer, a: AdjustmentDoc): string | null {
  if (a.status !== "pending") return "Already decided";
  if (!can(v, "dgoBudgets", "approve")) return "Waiting for finance";
  if (String(a.proposedBy) === v.userId) return "You proposed it, so someone else decides";
  if ((v.employee && v.employee._id === String(a.employee)) || (a.user && String(a.user) === v.userId)) return "These are your own points, so someone else decides";
  return null;
}

function adjustmentDto(v: DgoViewer, a: AdjustmentDoc) {
  const why = whyCannotDecideAdjustment(v, a);
  return {
    id: String(a._id),
    employee: { id: String(a.employee), name: a.employeeName, department: a.departmentName ?? null },
    points: a.points,
    reason: a.reason,
    status: a.status,
    proposedByName: a.proposedByName ?? null,
    proposedAt: iso(a.createdAt)!,
    decidedByName: a.decidedByName ?? null,
    decidedAt: iso(a.decidedAt),
    decisionNote: a.decisionNote ?? null,
    canDecide: a.status === "pending" && !why,
    whyNot: a.status === "pending" ? why : null,
  };
}

/** GET /dgo-points/adjustments?status=pending|done */
export async function adjustmentsView(v: DgoViewer, statusIn?: string) {
  if (!can(v, "dgoBudgets", "view")) throw httpError("You can't see adjustments", 403);
  const status = statusIn === "done" ? "done" : "pending";
  const pendingF = { organization: v.orgId, status: "pending" };
  const doneF = { organization: v.orgId, status: { $in: ["approved", "rejected"] } };
  const [pending, done, rows] = await Promise.all([
    DgoAdjustment.countDocuments(pendingF),
    DgoAdjustment.countDocuments(doneF),
    DgoAdjustment.find(status === "pending" ? pendingF : doneF).sort({ createdAt: status === "pending" ? 1 : -1 }).limit(200).lean<AdjustmentDoc[]>(),
  ]);
  return { items: rows.map((a) => adjustmentDto(v, a)), counts: { pending, done } };
}

/** POST /dgo-points/adjustments — finance proposes. */
export async function proposeAdjustment(v: DgoViewer, input: { employeeId: string; points: number; reason: string; requestId: string }) {
  if (!can(v, "dgoBudgets", "edit")) throw httpError("Only finance can propose an adjustment", 403);
  if (!Number.isInteger(input.points) || input.points === 0) throw httpError("Say how many points to add (+) or remove (−)", 400);
  if (!input.reason?.trim()) throw httpError("Say why", 400);
  const key = `ADJUSTMENT:${v.orgId}:${input.requestId}`;
  const existing = await DgoAdjustment.findOne({ idempotencyKey: key }).lean<AdjustmentDoc>();
  if (existing) return { adjustment: adjustmentDto(v, existing), message: "Already proposed" };
  if (!isObjectId(input.employeeId)) throw httpError("Unknown employee", 400);
  const emp = await Employee.findOne({ _id: input.employeeId, organization: v.orgId }).select("name user department").lean<{ _id: Types.ObjectId; name: string; user?: unknown; department?: unknown }>();
  if (!emp) throw httpError("That employee isn't in this organisation", 404);
  if ((v.employee && v.employee._id === String(emp._id)) || (emp.user && String(emp.user) === v.userId)) {
    await dgoAudit(v, "adjustment_refused", "employee", emp._id, null, { reason: "own points" });
    throw httpError("You can't adjust your own points", 403);
  }
  const dept = emp.department ? await Department.findById(emp.department).select("name").lean<{ name: string }>() : null;
  let doc;
  try {
    doc = await DgoAdjustment.create({
      organization: v.orgId, employee: emp._id, user: emp.user ?? null, employeeName: emp.name, departmentName: dept?.name ?? null,
      points: input.points, reason: input.reason.trim(), proposedBy: v.userId, proposedByName: v.name, idempotencyKey: key,
    });
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    return { adjustment: adjustmentDto(v, (await DgoAdjustment.findOne({ idempotencyKey: key }).lean<AdjustmentDoc>())!), message: "Already proposed" };
  }
  const a = doc.toObject() as unknown as AdjustmentDoc;
  await dgoAudit(v, "adjustment_proposed", "adjustment", a._id, null, { employee: emp.name, points: input.points, reason: input.reason.trim() });
  const approvers = (await usersWith(v.orgId, "dgoBudgets", "approve").catch(() => [])).filter((u) => u !== v.userId);
  await notify({ users: approvers, kind: "approval", organization: v.orgId, actor: v.userId, title: `DGO adjustment to approve: ${input.points > 0 ? "+" : ""}${input.points} for ${emp.name}`, body: input.reason.trim(), href: "/dgo-points/reports?tab=adjustments" });
  return { adjustment: adjustmentDto(v, a), message: "Proposed — a second finance person approves it" };
}

/** POST /dgo-points/adjustments/:id/approve | reject */
export async function decideAdjustment(v: DgoViewer, id: string, approve: boolean, note?: string | null) {
  if (!isObjectId(id)) throw httpError("Unknown adjustment", 400);
  const a = await DgoAdjustment.findOne({ _id: id, organization: v.orgId }).lean<AdjustmentDoc>();
  if (!a) throw httpError("That adjustment no longer exists", 404);
  if (a.status !== "pending") {
    if (String((a as unknown as { decidedBy?: unknown }).decidedBy) === v.userId) return { adjustment: adjustmentDto(v, a), message: "Already done" };
    throw httpError(`Already ${a.status}`, 409);
  }
  const why = whyCannotDecideAdjustment(v, a);
  if (why) {
    if (/your own|You proposed/.test(why)) await dgoAudit(v, "adjustment_refused", "adjustment", a._id, null, { reason: why });
    throw httpError(why, 403);
  }
  if (!approve && !note?.trim()) throw httpError("Say why you're rejecting it", 400);
  const decided = { decidedBy: v.userId, decidedByName: v.name, decidedAt: new Date(), decisionNote: note?.trim() || null };
  if (!approve) {
    const r = await DgoAdjustment.updateOne({ _id: a._id, status: "pending" }, { $set: { status: "rejected", ...decided } });
    if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
    await dgoAudit(v, "adjustment_rejected", "adjustment", a._id, { status: "pending" }, { status: "rejected", note: note?.trim() });
    return { adjustment: adjustmentDto(v, (await DgoAdjustment.findById(a._id).lean<AdjustmentDoc>())!), message: "Rejected" };
  }
  const today = dayIn(v.tz);
  const settings = await settingsOn(v.orgId, today);
  const move = {
    organization: a.organization, employee: a.employee, points: Math.abs(a.points), key: `ADJUST:${a._id}`,
    description: `Adjustment: ${a.reason}`.slice(0, 300), today, expiryMonths: settings.expiryMonths,
  };
  const outcome = await inTransaction(async (session) => {
    const claimed = await DgoAdjustment.findOneAndUpdate({ _id: a._id, status: "pending" }, { $set: { status: "approved", ...decided } }, { new: true, session });
    if (!claimed) return "already" as const;
    if (a.points > 0) {
      await addPoints(move, actorOf(v), session);
      return "done" as const;
    }
    const ok = await removePoints(move, actorOf(v), session);
    if (ok === null) {
      // Not enough to take: back to pending (the transaction, or by hand without one).
      await DgoAdjustment.updateOne({ _id: a._id }, { $set: { status: "pending", decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null } }, { session });
      return "short" as const;
    }
    return "done" as const;
  });
  if (outcome === "already") throw httpError("It changed in the meantime — refresh", 409);
  if (outcome === "short") throw httpError(`${a.employeeName} doesn't have ${Math.abs(a.points).toLocaleString("en")} points to spend right now, so nothing was taken`, 409);
  await dgoAudit(v, "adjustment_approved", "adjustment", a._id, { status: "pending" }, { status: "approved", points: a.points, employee: a.employeeName });
  await notify({
    users: [a.user], kind: "system", tone: a.points > 0 ? "positive" : "negative", organization: v.orgId, actor: v.userId,
    title: `${a.points > 0 ? "+" : "−"}${Math.abs(a.points).toLocaleString("en")} DGO Points`, body: `Adjustment: ${a.reason}`, href: "/dgo-points/wallet",
  });
  return { adjustment: adjustmentDto(v, (await DgoAdjustment.findById(a._id).lean<AdjustmentDoc>())!), message: "Approved — the points have moved" };
}

/* ───────────── Allowance overrides ───────────── */

/** POST /dgo-points/budgets/:month/overrides — finance proposes a different allowance. */
export async function proposeOverride(v: DgoViewer, monthIn: string, input: { departmentId: string | null; allocationAed: number; reason: string; requestId: string }) {
  if (!can(v, "dgoBudgets", "edit")) throw httpError("Only finance can propose an override", 403);
  if (!isMonth(monthIn) || monthIn > dayIn(v.tz).slice(0, 7)) throw httpError("Pick this month or an earlier open one", 400);
  await assertMonthOpen(v.orgId, monthIn, "its allowances can't change");
  if (!(input.allocationAed >= 0)) throw httpError("Enter the new allowance in AED", 400);
  if (!input.reason?.trim()) throw httpError("Say why", 400);
  const key = `OVERRIDE:${v.orgId}:${input.requestId}`;
  const existing = await DgoBudgetOverride.findOne({ idempotencyKey: key }).lean<OverrideDoc>();
  if (existing) return { override: overrideDto(v, existing), message: "Already proposed" };
  const period = await ensurePeriod(v.orgId, monthIn);
  const department = input.departmentId && isObjectId(input.departmentId) ? input.departmentId : null;
  const row = await DgoDepartmentBudget.findOne({ period: period._id, department }).lean<{ departmentName: string; allocationFils: number; committedFils: number }>();
  if (!row) throw httpError("That department has no allowance this month", 404);
  const toFilsV = toFils(input.allocationAed);
  if (toFilsV < row.committedFils) throw httpError(`It has already used AED ${toAed(row.committedFils).toFixed(2)}, so it can't go below that`, 400);
  const doc = await DgoBudgetOverride.create({
    organization: v.orgId, month: monthIn, department, departmentName: row.departmentName,
    fromFils: row.allocationFils, toFils: toFilsV, reason: input.reason.trim(), proposedBy: v.userId, proposedByName: v.name, idempotencyKey: key,
  });
  const o = doc.toObject() as unknown as OverrideDoc;
  await dgoAudit(v, "override_proposed", "budget_override", o._id, { allocationAed: toAed(row.allocationFils) }, { allocationAed: input.allocationAed, department: row.departmentName, month: monthIn, reason: input.reason.trim() });
  const approvers = (await usersWith(v.orgId, "dgoBudgets", "approve").catch(() => [])).filter((u) => u !== v.userId);
  await notify({ users: approvers, kind: "approval", organization: v.orgId, actor: v.userId, title: `DGO allowance override to approve: ${row.departmentName}`, body: `AED ${toAed(row.allocationFils).toFixed(2)} → ${input.allocationAed.toFixed(2)} for ${monthIn}`, href: `/dgo-points/budgets?month=${monthIn}` });
  return { override: overrideDto(v, o), message: "Proposed — a second finance person approves it" };
}

/** POST /dgo-points/overrides/:id/approve | reject */
export async function decideOverride(v: DgoViewer, id: string, approve: boolean, note?: string | null) {
  if (!isObjectId(id)) throw httpError("Unknown override", 400);
  const o = await DgoBudgetOverride.findOne({ _id: id, organization: v.orgId }).lean<OverrideDoc & { decidedBy?: unknown }>();
  if (!o) throw httpError("That override no longer exists", 404);
  if (o.status !== "pending") {
    if (String(o.decidedBy) === v.userId) return { override: overrideDto(v, o), message: "Already done" };
    throw httpError(`Already ${o.status}`, 409);
  }
  const why = whyCannotDecideOverride(v, o);
  if (why) {
    if (/You proposed/.test(why)) await dgoAudit(v, "override_refused", "budget_override", o._id, null, { reason: why });
    throw httpError(why, 403);
  }
  if (!approve && !note?.trim()) throw httpError("Say why you're rejecting it", 400);
  const decided = { decidedBy: v.userId, decidedByName: v.name, decidedAt: new Date(), decisionNote: note?.trim() || null };
  if (approve) {
    await assertMonthOpen(v.orgId, o.month, "its allowances can't change");
    const period = await ensurePeriod(v.orgId, o.month);
    const r = await DgoDepartmentBudget.updateOne(
      { period: period._id, department: o.department ?? null, committedFils: { $lte: o.toFils } },
      { $set: { allocationFils: o.toFils, overrideFils: o.toFils } }
    );
    if (!r.matchedCount) throw httpError(`${o.departmentName} has used more than AED ${toAed(o.toFils).toFixed(2)} since this was proposed`, 409);
  }
  const r = await DgoBudgetOverride.updateOne({ _id: o._id, status: "pending" }, { $set: { status: approve ? "approved" : "rejected", ...decided } });
  if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
  await dgoAudit(v, approve ? "override_approved" : "override_rejected", "budget_override", o._id, { status: "pending", allocationAed: toAed(o.fromFils) }, { status: approve ? "approved" : "rejected", allocationAed: toAed(o.toFils), note: note?.trim() || null });
  return { override: overrideDto(v, (await DgoBudgetOverride.findById(o._id).lean<OverrideDoc>())!), message: approve ? `Approved — ${o.departmentName}'s allowance is now AED ${toAed(o.toFils).toFixed(2)}` : "Rejected" };
}
