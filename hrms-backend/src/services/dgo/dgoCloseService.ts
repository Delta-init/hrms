import type { Types } from "mongoose";
import { DgoBudgetPeriod } from "../../models/DgoBudgetPeriod.js";
import { DgoDepartmentBudget } from "../../models/DgoDepartmentBudget.js";
import { DgoLedgerEntry } from "../../models/DgoLedgerEntry.js";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { DgoRedemption } from "../../models/DgoRedemption.js";
import { DgoAchieverMonth } from "../../models/DgoAchieverMonth.js";
import { DgoBudgetOverride } from "../../models/DgoBudgetOverride.js";
import { notify } from "../notificationService.js";
import { dayIn, isMonth, pointsToFils, previousMonth, tierLabel, toAed } from "./dgoMath.js";
import { httpError } from "./dgoErrors.js";
import { dgoAudit } from "./dgoAudit.js";
import { can, oid, usersWith, type DgoViewer } from "./dgoAccess.js";

/**
 * Month close and the point totals behind it.
 *
 * Outstanding points (what people can spend plus what is held for redemptions)
 * move only by ledger rows, so for any month:
 *
 *   opening + issued − spent − reversed − expired + adjusted = closing
 *
 * where opening is every row dated before the month and each term is that
 * month's rows of one type (reserve and release move points between spendable
 * and held, so they net to nothing). Credits are dated on the day earned,
 * everything else on the day it happened.
 *
 * Close: one finance person asks (the period goes to `review`, and nothing more
 * can be recorded into the month), a second one closes it — the totals are
 * snapshotted and the month is locked for good. A later correction is a row in
 * the current month (a reversal or an adjustment), never an edit of a closed one.
 */

export interface PointTotals { opening: number; issued: number; spent: number; reversed: number; expired: number; adjusted: number; closing: number }

const zero = (): PointTotals => ({ opening: 0, issued: 0, spent: 0, reversed: 0, expired: 0, adjusted: 0, closing: 0 });

/** Point totals for a month, for the organisation (key "all") and for each employee. */
export async function pointTotals(orgId: string, month: string, opts: { perEmployee?: boolean } = {}) {
  const rows = await DgoLedgerEntry.aggregate<{ _id: { e: unknown; t: string; cur: boolean }; d: number; h: number }>([
    { $match: { organization: oid(orgId), month: { $lte: month } } },
    {
      $group: {
        _id: { e: opts.perEmployee ? "$employee" : null, t: "$type", cur: { $eq: ["$month", month] } },
        d: { $sum: "$delta" },
        h: { $sum: { $ifNull: ["$reservedDelta", 0] } },
      },
    },
  ]);
  const out = new Map<string, PointTotals>();
  for (const r of rows) {
    const key = opts.perEmployee ? String(r._id.e) : "all";
    const t = out.get(key) ?? zero();
    const moved = r.d + r.h; // change to outstanding
    if (!r._id.cur) t.opening += moved;
    else {
      switch (r._id.t) {
        case "credit": t.issued += r.d; break;
        case "reverse": t.reversed -= r.d; break;
        case "expire": t.expired -= r.d; break;
        case "redeem": t.spent -= r.h; break;
        case "adjust": t.adjusted += r.d; break;
        default: break; // reserve / release: between spendable and held
      }
    }
    t.closing += moved;
    out.set(key, t);
  }
  if (!out.has("all") && !opts.perEmployee) out.set("all", zero());
  return out;
}

export const equationHolds = (t: PointTotals) => t.opening + t.issued - t.spent - t.reversed - t.expired + t.adjusted === t.closing;

/** The months still being worked in: anything not closed and not under review. */
export async function assertMonthOpen(orgId: string, month: string, doing: string): Promise<void> {
  const p = await DgoBudgetPeriod.findOne({ organization: orgId, month }).select("status").lean<{ status: string }>();
  if (p?.status === "closed") throw httpError(`${month} is closed, so ${doing}`, 409);
  if (p?.status === "review") throw httpError(`${month} is being closed, so ${doing}`, 409);
}

interface PeriodDoc {
  _id: Types.ObjectId;
  organization: unknown;
  month: string;
  status: "open" | "review" | "finance_approved" | "closed";
  pointValueAed: number;
  tierIndex: number;
  tiers: Array<{ minCollections: number; everydayAed: number; eliteAed: number }>;
  everydayFils: number;
  eliteFils: number;
  eliteCommittedFils?: number;
  collections: { confirmedFils: number | null };
  closeRequestedBy?: unknown; closeRequestedByName?: string | null; closeRequestedAt?: Date | null; closeRequestNote?: string | null;
  closedAt?: Date | null; closedByName?: string | null;
  snapshot?: Snapshot | null;
  collectionsSource?: "typed" | "finance" | null;
  collectionsBreakdown?: unknown;
}

export interface Snapshot {
  takenAt: string;
  pointValueAed: number;
  collectionsAed: number | null;
  tierLabel: string;
  everydayAed: number; eliteAed: number; elitePaidAed: number;
  points: PointTotals;
  liabilityAed: number;
  departments: Array<{ name: string; group: "revenue" | "other"; allocationAed: number; committedAed: number; overrideAed: number | null }>;
  counts: { earningsPosted: number; nominationsPosted: number; redemptionsFulfilled: number; adjustments: number };
}

/** A Dubai month as instants, for documents dated by createdAt / fulfilledAt. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - 4 * 3_600_000);
  const to = new Date(Date.UTC(y, m, 1) - 4 * 3_600_000);
  return { from, to };
}

/** Why a month can't be closed yet, in plain words; empty when it can. */
export async function closeBlockers(orgId: string, month: string, today: string): Promise<string[]> {
  const out: string[] = [];
  if (month >= today.slice(0, 7)) out.push("The month isn't over yet");
  const prev = await DgoBudgetPeriod.findOne({ organization: orgId, month: previousMonth(month) }).select("status").lean<{ status: string }>();
  if (prev && prev.status !== "closed") out.push(`Close ${previousMonth(month)} first`);
  const waiting = await DgoEarningEvent.countDocuments({ organization: orgId, month, status: "pending" });
  if (waiting) out.push(`${waiting} request${waiting === 1 ? "" : "s"} for ${month} still wait${waiting === 1 ? "s" : ""} for a decision (Points Approvals)`);
  const overrides = await DgoBudgetOverride.countDocuments({ organization: orgId, month, status: "pending" });
  if (overrides) out.push(`${overrides} allowance override${overrides === 1 ? "" : "s"} for ${month} still wait${overrides === 1 ? "s" : ""} for a decision`);
  const ach = await DgoAchieverMonth.findOne({ organization: orgId, month }).select("status categories").lean<{ status: string; categories: Array<{ winner: unknown; tie: boolean }> }>();
  if (ach && (ach.status === "verified" || ach.status === "approved")) out.push(`Monthly achievers for ${month} are ${ach.status === "verified" ? "verified but not yet approved" : "approved but not every prize is paid"}`);
  if (ach && ach.status === "provisional" && ach.categories.some((c) => c.winner || c.tie)) {
    out.push(`Monthly achievers for ${month} were fetched but not published (publish them, or switch off the categories you won't award and fetch again)`);
  }
  return out;
}

async function takeSnapshot(period: PeriodDoc): Promise<Snapshot> {
  const orgId = String(period.organization);
  const totals = (await pointTotals(orgId, period.month)).get("all")!;
  const { from, to } = monthRange(period.month);
  const [rows, earningsPosted, nominationsPosted, redemptionsFulfilled, adjustments] = await Promise.all([
    DgoDepartmentBudget.find({ period: period._id }).sort({ group: -1, departmentName: 1 }).lean<Array<{ departmentName: string; group: "revenue" | "other"; allocationFils: number; committedFils: number; overrideFils?: number | null }>>(),
    DgoEarningEvent.countDocuments({ organization: orgId, month: period.month, status: "posted" }),
    DgoEarningEvent.countDocuments({ organization: orgId, month: period.month, status: "posted", origin: "nomination" }),
    DgoRedemption.countDocuments({ organization: orgId, status: "fulfilled", fulfilledAt: { $gte: from, $lt: to } }),
    DgoLedgerEntry.countDocuments({ organization: orgId, month: period.month, type: "adjust" }),
  ]);
  const sorted = [...period.tiers].sort((a, b) => a.minCollections - b.minCollections);
  return {
    takenAt: new Date().toISOString(),
    pointValueAed: period.pointValueAed,
    collectionsAed: period.collections.confirmedFils != null ? toAed(period.collections.confirmedFils) : null,
    tierLabel: tierLabel(period.tierIndex, sorted),
    everydayAed: toAed(period.everydayFils),
    eliteAed: toAed(period.eliteFils),
    elitePaidAed: toAed(period.eliteCommittedFils ?? 0),
    points: totals,
    liabilityAed: toAed(pointsToFils(totals.closing, period.pointValueAed)),
    departments: rows.map((r) => ({
      name: r.departmentName, group: r.group, allocationAed: toAed(r.allocationFils), committedAed: toAed(r.committedFils),
      overrideAed: r.overrideFils != null ? toAed(r.overrideFils) : null,
    })),
    counts: { earningsPosted, nominationsPosted, redemptionsFulfilled, adjustments },
  };
}

function monthArg(v: DgoViewer, m: string): string {
  if (!isMonth(m)) throw httpError("month must be YYYY-MM", 400);
  if (m > dayIn(v.tz).slice(0, 7)) throw httpError("That month hasn't started", 400);
  return m;
}

/** POST /budgets/:month/close/request — the first finance person. */
export async function requestClose(v: DgoViewer, monthIn: string, note?: string | null) {
  if (!can(v, "dgoBudgets", "edit")) throw httpError("Only finance can close a month", 403);
  const month = monthArg(v, monthIn);
  const period = await DgoBudgetPeriod.findOne({ organization: v.orgId, month }).lean<PeriodDoc>();
  if (!period) throw httpError(`${month} has no DGO Points budget to close`, 404);
  if (period.status === "closed") throw httpError(`${month} is already closed`, 409);
  if (period.status === "review") {
    if (String(period.closeRequestedBy) === v.userId) return { message: "Already asked" };
    throw httpError(`${period.closeRequestedByName ?? "Someone"} has already asked to close ${month}`, 409);
  }
  const blockers = await closeBlockers(v.orgId, month, dayIn(v.tz));
  if (blockers.length) throw httpError(`${month} can't be closed yet: ${blockers.join("; ")}`, 409);
  const at = new Date();
  const r = await DgoBudgetPeriod.updateOne(
    { _id: period._id, status: { $in: ["open", "finance_approved"] } },
    {
      $set: { status: "review", closeRequestedBy: v.userId, closeRequestedByName: v.name, closeRequestedAt: at, closeRequestNote: note?.trim() || null },
      $push: { history: { action: "close_requested", amountFils: null, by: v.userId, byName: v.name, note: note?.trim() || null, at } },
    }
  );
  if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
  await dgoAudit(v, "close_requested", "budget_period", month, { status: period.status }, { status: "review", note: note?.trim() || null });
  const approvers = (await usersWith(v.orgId, "dgoBudgets", "approve").catch(() => [])).filter((u) => u !== v.userId);
  await notify({ users: approvers, kind: "approval", organization: v.orgId, actor: v.userId, title: `Close DGO Points for ${month}?`, body: `Asked by ${v.name}`, href: `/dgo-points/budgets?month=${month}` });
  return { message: "Asked — a second finance person closes it" };
}

/** POST /budgets/:month/close/approve — the second finance person: snapshot and lock. */
export async function approveClose(v: DgoViewer, monthIn: string, note?: string | null) {
  if (!can(v, "dgoBudgets", "approve")) throw httpError("Only finance can close a month", 403);
  const month = monthArg(v, monthIn);
  const period = await DgoBudgetPeriod.findOne({ organization: v.orgId, month }).lean<PeriodDoc>();
  if (!period) throw httpError(`${month} has no DGO Points budget to close`, 404);
  if (period.status === "closed") return { message: "Already closed" };
  if (period.status !== "review") throw httpError("Someone in finance asks to close it first", 409);
  if (String(period.closeRequestedBy) === v.userId) {
    await dgoAudit(v, "close_self_approve_refused", "budget_period", month, null, null);
    throw httpError("You asked to close it, so someone else closes it", 403);
  }
  const blockers = (await closeBlockers(v.orgId, month, dayIn(v.tz)));
  if (blockers.length) throw httpError(`${month} can't be closed yet: ${blockers.join("; ")}`, 409);
  const snapshot = await takeSnapshot(period);
  const at = new Date();
  const r = await DgoBudgetPeriod.updateOne(
    { _id: period._id, status: "review" },
    {
      $set: { status: "closed", closedAt: at, closedBy: v.userId, closedByName: v.name, snapshot },
      $push: { history: { action: "closed", amountFils: null, by: v.userId, byName: v.name, note: note?.trim() || null, at } },
    }
  );
  if (!r.modifiedCount) throw httpError("It changed in the meantime — refresh", 409);
  await dgoAudit(v, "month_closed", "budget_period", month, { status: "review" }, { status: "closed", points: snapshot.points, liabilityAed: snapshot.liabilityAed });
  return { message: `${month} is closed` };
}

/** POST /budgets/:month/close/cancel — back to open, with why. */
export async function cancelClose(v: DgoViewer, monthIn: string, reason: string) {
  if (!can(v, "dgoBudgets", "edit") && !can(v, "dgoBudgets", "approve")) throw httpError("Only finance can do that", 403);
  if (!reason?.trim()) throw httpError("Say why", 400);
  const month = monthArg(v, monthIn);
  const at = new Date();
  const r = await DgoBudgetPeriod.updateOne(
    { organization: v.orgId, month, status: "review" },
    {
      $set: { status: "open", closeRequestedBy: null, closeRequestedByName: null, closeRequestedAt: null, closeRequestNote: null },
      $push: { history: { action: "close_cancelled", amountFils: null, by: v.userId, byName: v.name, note: reason.trim(), at } },
    }
  );
  if (!r.modifiedCount) throw httpError("Only a month waiting to be closed can be sent back", 409);
  await dgoAudit(v, "close_cancelled", "budget_period", month, { status: "review" }, { status: "open", reason: reason.trim() });
  return { message: "Back to open" };
}

/** The Phase 3 part of the budget page: close, overrides, collections source. */
export async function budgetExtras(v: DgoViewer, period: PeriodDoc) {
  const today = dayIn(v.tz);
  const status = period.status === "closed" ? "closed" : period.status === "review" ? "review" : "open";
  const [blockers, overrides] = await Promise.all([
    status === "closed" ? Promise.resolve([] as string[]) : closeBlockers(v.orgId, period.month, today),
    DgoBudgetOverride.find({ organization: v.orgId, month: period.month }).sort({ status: 1, createdAt: -1 }).limit(100).lean<OverrideDoc[]>(),
  ]);
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  const requestedByMe = String(period.closeRequestedBy) === v.userId;
  return {
    close: {
      status,
      requestedByName: period.closeRequestedByName ?? null,
      requestedAt: iso(period.closeRequestedAt),
      requestNote: period.closeRequestNote ?? null,
      closedByName: period.closedByName ?? null,
      closedAt: iso(period.closedAt),
      blockers,
      snapshot: period.snapshot ?? null,
      can: {
        request: status === "open" && blockers.length === 0 && can(v, "dgoBudgets", "edit"),
        approve: status === "review" && blockers.length === 0 && can(v, "dgoBudgets", "approve") && !requestedByMe,
        cancel: status === "review" && (can(v, "dgoBudgets", "edit") || can(v, "dgoBudgets", "approve")),
      },
    },
    overrides: overrides.map((o) => overrideDto(v, o)),
    collectionsSource: period.collectionsSource ?? null,
    collectionsBreakdown: period.collectionsBreakdown ?? null,
    canMore: {
      fetchCollections: status === "open" && can(v, "dgoBudgets", "edit"),
      proposeOverride: status === "open" && can(v, "dgoBudgets", "edit"),
    },
  };
}

export interface OverrideDoc {
  _id: Types.ObjectId; organization: unknown; month: string; department: unknown; departmentName: string;
  fromFils: number; toFils: number; reason: string; status: "pending" | "approved" | "rejected";
  proposedBy: unknown; proposedByName: string | null; createdAt: Date;
  decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null;
}

export function whyCannotDecideOverride(v: DgoViewer, o: { status: string; proposedBy: unknown }): string | null {
  if (o.status !== "pending") return "Already decided";
  if (!can(v, "dgoBudgets", "approve")) return "Waiting for finance";
  if (String(o.proposedBy) === v.userId) return "You proposed it, so someone else decides";
  return null;
}

export function overrideDto(v: DgoViewer, o: OverrideDoc) {
  const why = whyCannotDecideOverride(v, o);
  return {
    id: String(o._id),
    month: o.month,
    department: { id: o.department ? String(o.department) : null, name: o.departmentName },
    fromAed: toAed(o.fromFils),
    toAed: toAed(o.toFils),
    reason: o.reason,
    status: o.status,
    proposedByName: o.proposedByName ?? null,
    proposedAt: new Date(o.createdAt).toISOString(),
    decidedByName: o.decidedByName ?? null,
    decidedAt: o.decidedAt ? new Date(o.decidedAt).toISOString() : null,
    decisionNote: o.decisionNote ?? null,
    canDecide: o.status === "pending" && !why,
    whyNot: o.status === "pending" ? why : null,
  };
}
