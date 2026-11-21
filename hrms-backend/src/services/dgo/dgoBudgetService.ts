import type { ClientSession, Types } from "mongoose";
import { DgoBudgetPeriod } from "../../models/DgoBudgetPeriod.js";
import { DgoDepartmentBudget } from "../../models/DgoDepartmentBudget.js";
import { DgoProgram } from "../../models/DgoProgram.js";
import { Department } from "../../models/Department.js";
import { Employee } from "../../models/Employee.js";
import { ACTIVE_EMPLOYEE_STATUSES } from "./dgoDefaults.js";
import { dayIn, isMonth, previousMonth, splitAllocations, tierFor, tierLabel, toAed, toFils, type DgoTier } from "./dgoMath.js";
import { httpError, isDuplicateKey } from "./dgoErrors.js";
import { settingsOn } from "./dgoSettingsService.js";
import { dgoAudit } from "./dgoAudit.js";
import { can, oid, type DgoViewer } from "./dgoAccess.js";

/**
 * One month's DGO Points money.
 *
 * The month runs on a tier: this month's eligible collections once finance has
 * entered and a second person confirmed them; until then last month's confirmed
 * figure; and with neither, the lowest tier. The elite pool opens only on this
 * month's own confirmed figure, since elite awards are decided on it.
 *
 * The everyday pool is split 55/45 between revenue and other departments, then
 * by headcount within each group. Each department's `committedFils` only moves
 * by a conditional increment, so the allowance can't be passed.
 */

export interface PeriodDoc {
  _id: Types.ObjectId;
  organization: unknown;
  month: string;
  status: "open" | "review" | "finance_approved" | "closed";
  settingsVersion: number;
  pointValueAed: number;
  revenueSharePct: number;
  tiers: DgoTier[];
  tierIndex: number;
  tierBasis: "confirmed" | "previous_month" | "lowest";
  tierBasisMonth: string | null;
  everydayFils: number;
  eliteFils: number;
  eliteCommittedFils?: number;
  revenueDepartments: unknown[];
  collections: {
    enteredFils: number | null; enteredBy: unknown; enteredByName: string | null; enteredAt: Date | null; note: string | null;
    confirmedFils: number | null; confirmedBy: unknown; confirmedByName: string | null; confirmedAt: Date | null;
  };
  history: Array<{ action: string; amountFils: number | null; byName: string | null; note: string | null; at: Date }>;
}

interface RowDoc {
  _id: Types.ObjectId;
  department: unknown;
  departmentName: string;
  group: "revenue" | "other";
  headcount: number;
  allocationFils: number;
  committedFils: number;
}

const NO_DEPT = "none";
const keyOf = (department: unknown) => (department ? String(department) : NO_DEPT);

/** Active people per department, with names and their group. */
async function headcounts(orgId: string, revenueDepartments: unknown[]) {
  const revenue = new Set(revenueDepartments.map(String));
  const [counts, departments] = await Promise.all([
    Employee.aggregate<{ _id: unknown; n: number }>([
      { $match: { organization: oid(orgId), status: { $in: ACTIVE_EMPLOYEE_STATUSES } } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
    ]),
    Department.find({ organization: orgId }).select("name").lean<Array<{ _id: unknown; name: string }>>(),
  ]);
  const name = new Map(departments.map((d) => [String(d._id), d.name]));
  return counts.map((c) => ({
    key: keyOf(c._id),
    department: c._id ?? null,
    name: c._id ? name.get(String(c._id)) ?? "Unknown department" : "No department",
    group: c._id && revenue.has(String(c._id)) ? ("revenue" as const) : ("other" as const),
    headcount: c.n,
  }));
}

/** Rewrite every department's allowance from the period's pool and today's headcount. What is committed stays. */
export async function recomputeAllocations(period: PeriodDoc): Promise<void> {
  const orgId = String(period.organization);
  const people = await headcounts(orgId, period.revenueDepartments);
  const split = splitAllocations(period.everydayFils, period.revenueSharePct, people);
  for (const p of people) {
    await DgoDepartmentBudget.updateOne(
      { period: period._id, department: p.department },
      {
        $set: { departmentName: p.name, group: p.group, headcount: p.headcount, allocationFils: split.get(p.key) ?? 0 },
        $setOnInsert: { organization: period.organization, month: period.month, committedFils: 0 },
      },
      { upsert: true }
    ).catch((e) => { if (!isDuplicateKey(e)) throw e; });
  }
  // A department nobody is in any more keeps only what it already used.
  const live = new Set(people.map((p) => p.key));
  const stale = await DgoDepartmentBudget.find({ period: period._id }).lean<RowDoc[]>();
  for (const r of stale.filter((r) => !live.has(keyOf(r.department)))) {
    await DgoDepartmentBudget.updateOne({ _id: r._id }, { $set: { headcount: 0, allocationFils: r.committedFils } });
  }
}

/** The month's period, opening it (with its tier and allowances) the first time it is needed. */
export async function ensurePeriod(orgId: string, month: string): Promise<PeriodDoc> {
  const found = await DgoBudgetPeriod.findOne({ organization: orgId, month }).lean<PeriodDoc>();
  if (found) return found;
  const settings = await settingsOn(orgId, `${month}-01`);
  const prev = await DgoBudgetPeriod.findOne({ organization: orgId, month: previousMonth(month), "collections.confirmedFils": { $ne: null } })
    .select("collections")
    .lean<Pick<PeriodDoc, "collections">>();
  const basisAed = prev?.collections.confirmedFils != null ? toAed(prev.collections.confirmedFils) : null;
  const { index, tier } = tierFor(basisAed, settings.tiers);
  const program = await DgoProgram.findOne({ organization: orgId }).lean<{ revenueDepartments: unknown[] }>();
  try {
    await DgoBudgetPeriod.create({
      organization: orgId,
      month,
      status: "open",
      settingsVersion: settings.version,
      pointValueAed: settings.pointValueAed,
      revenueSharePct: settings.revenueSharePct,
      tiers: settings.tiers,
      tierIndex: index,
      tierBasis: basisAed !== null ? "previous_month" : "lowest",
      tierBasisMonth: basisAed !== null ? previousMonth(month) : null,
      everydayFils: toFils(tier.everydayAed),
      eliteFils: 0,
      revenueDepartments: program?.revenueDepartments ?? [],
      history: [{ action: "opened", amountFils: null, byName: null, note: basisAed !== null ? `Tier from ${previousMonth(month)}'s confirmed collections` : "No confirmed collections yet: lowest tier", at: new Date() }],
    });
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    return (await DgoBudgetPeriod.findOne({ organization: orgId, month }).lean<PeriodDoc>())!;
  }
  const period = (await DgoBudgetPeriod.findOne({ organization: orgId, month }).lean<PeriodDoc>())!;
  await recomputeAllocations(period);
  return period;
}

/**
 * The allowance row an award in this month and department will draw on, ready
 * before any transaction starts (opening a month writes several documents).
 */
export async function budgetRowFor(orgId: string, month: string, department: unknown): Promise<{ period: PeriodDoc; rowId: Types.ObjectId }> {
  const period = await ensurePeriod(orgId, month);
  let row = await DgoDepartmentBudget.findOne({ period: period._id, department: department ?? null }).select("_id").lean<{ _id: Types.ObjectId }>();
  if (!row) {
    // Somebody joined a department that had nobody when the month opened.
    await recomputeAllocations(period);
    row = await DgoDepartmentBudget.findOne({ period: period._id, department: department ?? null }).select("_id").lean<{ _id: Types.ObjectId }>();
  }
  if (!row) throw httpError("No allowance for that department this month", 409);
  return { period, rowId: row._id };
}

/** Take `fils` from a department's allowance, or nothing if it would pass the allowance. */
export async function commitBudget(rowId: Types.ObjectId, fils: number, session?: ClientSession): Promise<boolean> {
  if (fils <= 0) return true;
  const r = await DgoDepartmentBudget.updateOne(
    { _id: rowId, $expr: { $lte: [{ $add: ["$committedFils", fils] }, "$allocationFils"] } },
    { $inc: { committedFils: fils } },
    { session }
  );
  return r.modifiedCount === 1;
}

/** Give `fils` back to a department's allowance (a reversal, a superseded KPI award). */
export async function releaseBudget(orgId: string, month: string, department: unknown, fils: number, session?: ClientSession): Promise<void> {
  if (fils <= 0) return;
  const period = await DgoBudgetPeriod.findOne({ organization: orgId, month }).select("_id status").lean<{ _id: Types.ObjectId; status: string }>();
  if (!period || period.status === "closed") return;
  await DgoDepartmentBudget.updateOne(
    { period: period._id, department: department ?? null, committedFils: { $gte: fils } },
    { $inc: { committedFils: -fils } },
    { session }
  );
}

/**
 * Take a monthly achiever prize from the month's elite pool, or nothing if it
 * would pass the pool (closed months and a locked pool take nothing).
 */
export async function commitElite(orgId: string, month: string, fils: number, session?: ClientSession): Promise<boolean> {
  if (fils <= 0) return true;
  const r = await DgoBudgetPeriod.updateOne(
    { organization: orgId, month, status: { $ne: "closed" }, $expr: { $lte: [{ $add: [{ $ifNull: ["$eliteCommittedFils", 0] }, fils] }, "$eliteFils"] } },
    { $inc: { eliteCommittedFils: fils } },
    { session }
  );
  return r.modifiedCount === 1;
}

/** Give a prize back to the elite pool (a prize taken back). */
export async function releaseElite(orgId: string, month: string, fils: number, session?: ClientSession): Promise<void> {
  if (fils <= 0) return;
  await DgoBudgetPeriod.updateOne(
    { organization: orgId, month, status: { $ne: "closed" }, eliteCommittedFils: { $gte: fils } },
    { $inc: { eliteCommittedFils: -fils } },
    { session }
  );
}

/** A department's allowance left this month, in fils, without opening the month. */
export async function leftFor(orgId: string, month: string, department: unknown): Promise<{ name: string; leftFils: number } | null> {
  const period = await DgoBudgetPeriod.findOne({ organization: orgId, month }).select("_id").lean<{ _id: Types.ObjectId }>();
  if (!period) return null;
  const row = await DgoDepartmentBudget.findOne({ period: period._id, department: department ?? null }).lean<RowDoc>();
  return row ? { name: row.departmentName, leftFils: row.allocationFils - row.committedFils } : null;
}

function monthOrThis(v: DgoViewer, month?: string): string {
  const m = month || dayIn(v.tz).slice(0, 7);
  if (!isMonth(m)) throw httpError("month must be YYYY-MM", 400);
  if (m > dayIn(v.tz).slice(0, 7)) throw httpError("That month hasn't started", 400);
  return m;
}

/** GET /dgo-points/budgets?month= */
export async function budgetView(v: DgoViewer, monthIn?: string) {
  if (!can(v, "dgoBudgets", "view")) throw httpError("You can't see DGO Points budgets", 403);
  const month = monthOrThis(v, monthIn);
  const period = await ensurePeriod(v.orgId, month);
  const rows = await DgoDepartmentBudget.find({ period: period._id }).sort({ group: -1, departmentName: 1 }).lean<RowDoc[]>();
  const c = period.collections;
  const awaiting = c.enteredFils != null && (!c.confirmedAt || (c.enteredAt != null && new Date(c.enteredAt) > new Date(c.confirmedAt)));
  const committed = rows.reduce((s, r) => s + r.committedFils, 0);
  const sorted = [...period.tiers].sort((a, b) => a.minCollections - b.minCollections);
  const groups = (["revenue", "other"] as const).map((g) => {
    const inGroup = rows.filter((r) => r.group === g);
    const sharePct = g === "revenue" ? period.revenueSharePct : 100 - period.revenueSharePct;
    return {
      group: g,
      sharePct,
      shareAed: toAed(inGroup.reduce((s, r) => s + r.allocationFils, 0)),
      committedAed: toAed(inGroup.reduce((s, r) => s + r.committedFils, 0)),
      headcount: inGroup.reduce((s, r) => s + r.headcount, 0),
    };
  });
  return {
    month,
    status: period.status,
    pointValueAed: period.pointValueAed,
    revenueSharePct: period.revenueSharePct,
    tiers: sorted.map((t) => ({ minCollections: t.minCollections, everydayAed: t.everydayAed, eliteAed: t.eliteAed })),
    tierIndex: period.tierIndex,
    tierLabel: tierLabel(period.tierIndex, sorted),
    tierBasis: period.tierBasis,
    tierBasisMonth: period.tierBasisMonth,
    everydayAed: toAed(period.everydayFils),
    eliteAed: toAed(period.eliteFils),
    eliteUnlocked: period.eliteFils > 0,
    ceilingAed: toAed(period.everydayFils + period.eliteFils),
    committedAed: toAed(committed),
    leftAed: toAed(period.everydayFils - committed),
    collections: {
      enteredAed: c.enteredFils != null ? toAed(c.enteredFils) : null,
      enteredByName: c.enteredByName ?? null,
      enteredAt: c.enteredAt ? new Date(c.enteredAt).toISOString() : null,
      note: c.note ?? null,
      confirmedAed: c.confirmedFils != null ? toAed(c.confirmedFils) : null,
      confirmedByName: c.confirmedByName ?? null,
      confirmedAt: c.confirmedAt ? new Date(c.confirmedAt).toISOString() : null,
      awaitingConfirmation: awaiting,
    },
    groups,
    departments: rows.map((r) => ({
      id: r.department ? String(r.department) : null,
      name: r.departmentName,
      group: r.group,
      headcount: r.headcount,
      allocationAed: toAed(r.allocationFils),
      committedAed: toAed(r.committedFils),
      leftAed: toAed(Math.max(0, r.allocationFils - r.committedFils)),
    })),
    history: [...period.history].reverse().map((h) => ({
      action: h.action, amountAed: h.amountFils != null ? toAed(h.amountFils) : null, byName: h.byName ?? null, at: new Date(h.at).toISOString(), note: h.note ?? null,
    })),
    can: {
      enter: period.status !== "closed" && can(v, "dgoBudgets", "edit"),
      confirm: period.status !== "closed" && awaiting && can(v, "dgoBudgets", "approve") && String(c.enteredBy) !== v.userId,
      recount: period.status !== "closed" && can(v, "dgoBudgets", "edit"),
    },
  };
}

/** Finance enters the month's eligible collections. Nothing changes until a second person confirms it. */
export async function enterCollections(v: DgoViewer, monthIn: string, amountAed: number, note?: string) {
  if (!can(v, "dgoBudgets", "edit")) throw httpError("You can't enter collections", 403);
  const month = monthOrThis(v, monthIn);
  if (!(amountAed >= 0) || !Number.isFinite(amountAed)) throw httpError("Enter the eligible collections in AED", 400);
  const period = await ensurePeriod(v.orgId, month);
  if (period.status === "closed") throw httpError(`${month} is closed`, 409);
  const fils = toFils(amountAed);
  const at = new Date();
  await DgoBudgetPeriod.updateOne(
    { _id: period._id },
    {
      $set: { "collections.enteredFils": fils, "collections.enteredBy": v.userId, "collections.enteredByName": v.name, "collections.enteredAt": at, "collections.note": note?.trim() || null },
      $push: { history: { action: "collections_entered", amountFils: fils, by: v.userId, byName: v.name, note: note?.trim() || null, at } },
    }
  );
  await dgoAudit(v, "collections_entered", "budget_period", month, { enteredAed: period.collections.enteredFils != null ? toAed(period.collections.enteredFils) : null }, { enteredAed: amountAed, note: note ?? null });
  return budgetView(v, month);
}

/** A second person confirms the figure: the month's tier, pools and allowances follow from it. */
export async function confirmCollections(v: DgoViewer, monthIn: string) {
  if (!can(v, "dgoBudgets", "approve")) throw httpError("You can't confirm collections", 403);
  const month = monthOrThis(v, monthIn);
  const period = await ensurePeriod(v.orgId, month);
  if (period.status === "closed") throw httpError(`${month} is closed`, 409);
  const c = period.collections;
  if (c.enteredFils == null) throw httpError("Nothing has been entered to confirm", 409);
  if (String(c.enteredBy) === v.userId) {
    await dgoAudit(v, "collections_self_confirm_refused", "budget_period", month, null, { enteredAed: toAed(c.enteredFils) });
    throw httpError("You entered this figure, so someone else confirms it", 403);
  }
  if (c.confirmedAt && c.enteredAt && new Date(c.confirmedAt) >= new Date(c.enteredAt)) throw httpError("Already confirmed", 409);
  const aed = toAed(c.enteredFils);
  const { index, tier } = tierFor(aed, period.tiers);
  const at = new Date();
  // Conditional on the entry not having changed since this page was read.
  const r = await DgoBudgetPeriod.updateOne(
    { _id: period._id, "collections.enteredAt": c.enteredAt, "collections.enteredFils": c.enteredFils },
    {
      $set: {
        "collections.confirmedFils": c.enteredFils, "collections.confirmedBy": v.userId, "collections.confirmedByName": v.name, "collections.confirmedAt": at,
        tierIndex: index, tierBasis: "confirmed", tierBasisMonth: month,
        everydayFils: toFils(tier.everydayAed), eliteFils: toFils(tier.eliteAed),
      },
      $push: { history: { action: "collections_confirmed", amountFils: c.enteredFils, by: v.userId, byName: v.name, note: tierLabel(index, period.tiers), at } },
    }
  );
  if (!r.modifiedCount) throw httpError("The figure changed while you were looking — open it again", 409);
  const updated = (await DgoBudgetPeriod.findById(period._id).lean<PeriodDoc>())!;
  await recomputeAllocations(updated);
  await dgoAudit(v, "collections_confirmed", "budget_period", month,
    { tierIndex: period.tierIndex, everydayAed: toAed(period.everydayFils), eliteAed: toAed(period.eliteFils) },
    { collectionsAed: aed, tierIndex: index, everydayAed: tier.everydayAed, eliteAed: tier.eliteAed });
  return budgetView(v, month);
}

/**
 * Take the program's current revenue/other grouping into a month that is still
 * open and re-split it. Awards already made keep what they committed; only the
 * allowances move. Used when an admin changes the grouping, and by a recount.
 */
export async function refreshGrouping(orgId: string, month: string): Promise<void> {
  const period = await DgoBudgetPeriod.findOne({ organization: orgId, month }).lean<PeriodDoc>();
  if (!period || period.status === "closed") return;
  const program = await DgoProgram.findOne({ organization: orgId }).lean<{ revenueDepartments: unknown[] }>();
  await DgoBudgetPeriod.updateOne({ _id: period._id }, { $set: { revenueDepartments: program?.revenueDepartments ?? [] } });
  await recomputeAllocations({ ...period, revenueDepartments: program?.revenueDepartments ?? [] });
}

/** Re-read headcount and the revenue grouping, and re-split the pool. */
export async function recountBudget(v: DgoViewer, monthIn: string) {
  if (!can(v, "dgoBudgets", "edit")) throw httpError("You can't change budgets", 403);
  const month = monthOrThis(v, monthIn);
  const period = await ensurePeriod(v.orgId, month);
  if (period.status === "closed") throw httpError(`${month} is closed`, 409);
  const before = await DgoDepartmentBudget.find({ period: period._id }).select("departmentName headcount allocationFils").lean();
  await refreshGrouping(v.orgId, month);
  await DgoBudgetPeriod.updateOne({ _id: period._id }, { $push: { history: { action: "recounted", amountFils: null, by: v.userId, byName: v.name, note: "Headcount re-read", at: new Date() } } });
  const after = await DgoDepartmentBudget.find({ period: period._id }).select("departmentName headcount allocationFils").lean();
  await dgoAudit(v, "budget_recounted", "budget_period", month, before, after);
  return budgetView(v, month);
}
