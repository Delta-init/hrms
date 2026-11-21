import type { Types } from "mongoose";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { DgoLedgerEntry } from "../../models/DgoLedgerEntry.js";
import { DgoPointLot } from "../../models/DgoPointLot.js";
import { DgoWallet } from "../../models/DgoWallet.js";
import { DgoAuditEntry } from "../../models/DgoAuditEntry.js";
import { DgoBudgetPeriod } from "../../models/DgoBudgetPeriod.js";
import { DgoDepartmentBudget } from "../../models/DgoDepartmentBudget.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { ACTIVE_EMPLOYEE_STATUSES } from "./dgoDefaults.js";
import { dayIn, isDay, isMonth, pointsToFils, tierLabel, toAed } from "./dgoMath.js";
import { httpError } from "./dgoErrors.js";
import { programSettings, ruleDto, rulesOn, settingsOn } from "./dgoSettingsService.js";
import { publicUrl } from "../uploadService.js";
import { nominationChain, type EventDoc } from "./dgoEarningService.js";
import {
  assertCanUse, can, canApproveAchievers, canFulfil, canLookUpWallets, canManageRewards, canRecordAwards, canReviewAchievers,
  canRunAchievers, canSeeFulfilment, canUse, canVerifyAchievers, isObjectId, isOpen, oid, whyCannotDecide, type DgoViewer,
} from "./dgoAccess.js";

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");

/** GET /dgo-points/me */
export async function me(v: DgoViewer) {
  const today = dayIn(v.tz);
  const [program, settings, dept] = await Promise.all([
    programSettings(v.orgId),
    settingsOn(v.orgId, today),
    v.employee?.department ? Department.findById(v.employee.department).select("name").lean<{ name: string }>() : null,
  ]);
  const open = program.openToEmployees;
  const heads = open && v.headOf.length > 0;
  const usable = await canUse(v);
  return {
    open,
    canUse: usable,
    superAdmin: v.superAdmin,
    isHead: v.headOf.length > 0,
    can: {
      recordAwards: canRecordAwards(v, open),
      approvals: heads || can(v, "dgoApprovals", "view") || can(v, "dgoApprovals", "approve") || can(v, "dgoBudgets", "approve"),
      budgetsView: can(v, "dgoBudgets", "view"),
      budgetsEdit: can(v, "dgoBudgets", "edit"),
      budgetsApprove: can(v, "dgoBudgets", "approve"),
      settingsView: can(v, "dgoSettings", "view"),
      settingsEdit: can(v, "dgoSettings", "edit"),
      auditView: can(v, "dgoAudit", "view"),
      walletLookup: canLookUpWallets(v),
      reportsView: can(v, "dgoBudgets", "view") || can(v, "dgoAudit", "view"),
      reportsExport: can(v, "dgoBudgets", "export") || can(v, "dgoAudit", "export"),
      adjustmentsPropose: can(v, "dgoBudgets", "edit"),
      adjustmentsApprove: can(v, "dgoBudgets", "approve"),
      rewardsManage: canManageRewards(v),
      rewardsFulfil: canFulfil(v),
      rewardsView: canSeeFulfilment(v),
      achieversRun: canRunAchievers(v),
      achieversVerify: canVerifyAchievers(v),
      achieversApprove: canApproveAchievers(v),
      achieversReview: canReviewAchievers(v),
      nominate: usable && Boolean(v.employee) && program.nominationsPerMonth > 0,
    },
    leaderboardVisibility: program.leaderboardVisibility,
    nominationsPerMonth: program.nominationsPerMonth,
    employee: v.employee ? { id: v.employee._id, name: v.employee.name, department: dept?.name ?? null } : null,
    pointValueAed: settings.pointValueAed,
    timeZone: v.tz,
    today,
  };
}

interface LedgerDoc {
  _id: Types.ObjectId; createdAt: Date; day: string; type: string; delta: number; description: string;
  ruleCode: string | null; earningEvent: unknown; createdByName: string | null; lot: unknown; reservedDelta?: number; redemption?: unknown;
}

async function ledgerRows(rows: LedgerDoc[]) {
  const lotIds = rows.filter((r) => r.type === "credit" && r.lot).map((r) => r.lot);
  const lots = lotIds.length ? await DgoPointLot.find({ _id: { $in: lotIds } }).select("expiresOn").lean<Array<{ _id: unknown; expiresOn: string }>>() : [];
  const expires = new Map(lots.map((l) => [String(l._id), l.expiresOn]));
  return rows.map((r) => ({
    id: String(r._id),
    at: iso(r.createdAt),
    day: r.day,
    type: r.type,
    delta: r.delta,
    reservedDelta: r.reservedDelta ?? 0,
    redemptionId: r.redemption ? String(r.redemption) : null,
    description: r.description,
    ruleCode: r.ruleCode ?? null,
    eventId: r.earningEvent ? String(r.earningEvent) : null,
    byName: r.createdByName ?? null,
    expiresOn: r.type === "credit" && r.lot ? expires.get(String(r.lot)) ?? null : null,
  }));
}

async function balancesOf(employee: unknown) {
  const [w, pending] = await Promise.all([
    DgoWallet.findOne({ employee }).lean<{ available: number; reserved: number; redeemed: number; expired: number; reversed: number; lifetimeEarned: number }>(),
    DgoEarningEvent.aggregate<{ p: number }>([{ $match: { employee: oid(employee), status: "pending" } }, { $group: { _id: null, p: { $sum: "$points" } } }]),
  ]);
  return {
    available: w?.available ?? 0,
    pending: pending[0]?.p ?? 0,
    reserved: w?.reserved ?? 0,
    redeemed: w?.redeemed ?? 0,
    expired: w?.expired ?? 0,
    reversed: w?.reversed ?? 0,
    lifetimeEarned: w?.lifetimeEarned ?? 0,
  };
}

/** Net points credited in a month per employee (credits less reversals dated in it). */
async function monthPoints(orgId: string, month: string, employees?: unknown[]) {
  const rows = await DgoLedgerEntry.aggregate<{ _id: unknown; p: number }>([
    { $match: { organization: oid(orgId), month, type: { $in: ["credit", "reverse"] }, ...(employees ? { employee: { $in: employees.map(oid) } } : {}) } },
    { $group: { _id: "$employee", p: { $sum: "$delta" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.p]));
}

/** GET /dgo-points/dashboard?month= */
export async function dashboard(v: DgoViewer, monthIn?: string) {
  await assertCanUse(v);
  const today = dayIn(v.tz);
  const month = monthIn && isMonth(monthIn) ? monthIn : today.slice(0, 7);
  const settings = await settingsOn(v.orgId, today);
  const pv = settings.pointValueAed;

  let own = null;
  if (v.employee) {
    const empId = v.employee._id;
    const [balances, perPerson, todayRows, nextLot, recent, pendingItems] = await Promise.all([
      balancesOf(empId),
      monthPoints(v.orgId, month),
      DgoEarningEvent.aggregate<{ _id: string; p: number }>([
        { $match: { employee: oid(empId), day: today, capExempt: false, status: { $in: ["pending", "posted"] } } },
        { $group: { _id: "$source", p: { $sum: "$points" } } },
      ]),
      DgoPointLot.findOne({ employee: empId, remaining: { $gt: 0 }, expiresOn: { $gte: today } }).sort({ expiresOn: 1 }).lean<{ remaining: number; expiresOn: string }>(),
      DgoLedgerEntry.find({ employee: empId }).sort({ createdAt: -1 }).limit(6).lean<LedgerDoc[]>(),
      DgoEarningEvent.find({ employee: empId, status: "pending" }).sort({ createdAt: -1 }).limit(10).lean<EventDoc[]>(),
    ]);
    const mine = perPerson.get(empId) ?? 0;
    const ranked = [...perPerson.values()].filter((p) => p > 0).sort((a, b) => b - a);
    let department = null;
    if (v.employee.department) {
      const period = await DgoBudgetPeriod.findOne({ organization: v.orgId, month }).select("_id").lean<{ _id: unknown }>();
      const row = period ? await DgoDepartmentBudget.findOne({ period: period._id, department: v.employee.department }).lean<{ departmentName: string; group: "revenue" | "other"; allocationFils: number; committedFils: number }>() : null;
      if (row) department = { name: row.departmentName, group: row.group, allocationAed: toAed(row.allocationFils), committedAed: toAed(row.committedFils) };
    }
    own = {
      balances,
      availableAed: toAed(pointsToFils(balances.available, pv)),
      monthEarned: mine,
      today: {
        day: today,
        used: todayRows.reduce((s, r) => s + r.p, 0),
        autoUsed: todayRows.find((r) => r._id === "kpi")?.p ?? 0,
        cap: settings.dailyCap,
        autoCap: settings.autoKpiCap,
      },
      nextExpiry: nextLot ? { points: nextLot.remaining, on: nextLot.expiresOn } : null,
      rank: mine > 0 ? { position: ranked.indexOf(mine) + 1, of: ranked.length } : null,
      department,
      recent: await ledgerRows(recent),
      pendingItems: pendingItems.map((e) => ({ id: String(e._id), ruleCode: e.ruleCode, ruleName: e.ruleName, points: e.points, day: e.day, stage: e.stage })),
    };
  }

  let team = null;
  if (v.headOf.length && (await isOpen(v.orgId))) {
    const members = await Employee.find({ organization: v.orgId, department: { $in: v.headOf }, status: { $in: ACTIVE_EMPLOYEE_STATUSES } })
      .select("name department").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string; department: unknown }>>();
    const ids = members.map((m) => m._id);
    const [pts, wallets, depts] = await Promise.all([
      monthPoints(v.orgId, month, ids),
      DgoWallet.find({ employee: { $in: ids } }).select("employee available").lean<Array<{ employee: unknown; available: number }>>(),
      Department.find({ _id: { $in: v.headOf } }).select("name").lean<Array<{ _id: unknown; name: string }>>(),
    ]);
    const avail = new Map(wallets.map((w) => [String(w.employee), w.available]));
    const dname = new Map(depts.map((d) => [String(d._id), d.name]));
    team = {
      members: members.map((m) => ({
        employeeId: String(m._id), name: m.name, department: dname.get(String(m.department)) ?? null,
        monthPoints: pts.get(String(m._id)) ?? 0, available: avail.get(String(m._id)) ?? 0,
      })),
    };
  }

  let company = null;
  if (can(v, "dgoBudgets", "view")) {
    const period = await DgoBudgetPeriod.findOne({ organization: v.orgId, month }).lean<{ _id: unknown; everydayFils: number; eliteFils: number; tierIndex: number; tiers: Array<{ minCollections: number; everydayAed: number; eliteAed: number }>; tierBasis: "confirmed" | "previous_month" | "lowest" }>();
    const [pts, committed, active, pending] = await Promise.all([
      monthPoints(v.orgId, month),
      period ? DgoDepartmentBudget.aggregate<{ c: number }>([{ $match: { period: period._id } }, { $group: { _id: null, c: { $sum: "$committedFils" } } }]) : [],
      Employee.countDocuments({ organization: v.orgId, status: { $in: ACTIVE_EMPLOYEE_STATUSES } }),
      DgoEarningEvent.countDocuments({ organization: v.orgId, status: "pending" }),
    ]);
    const issued = [...pts.values()].reduce((s, p) => s + p, 0);
    company = {
      pointsIssued: issued,
      aedIssued: toAed(pointsToFils(issued, pv)),
      everydayAed: period ? toAed(period.everydayFils) : 0,
      eliteAed: period ? toAed(period.eliteFils) : 0,
      eliteUnlocked: Boolean(period && period.eliteFils > 0),
      committedAed: toAed(committed[0]?.c ?? 0),
      employeesEarning: [...pts.values()].filter((p) => p > 0).length,
      activeEmployees: active,
      pendingApprovals: pending,
      tierLabel: period ? tierLabel(period.tierIndex, period.tiers) : "Not opened yet",
      tierBasis: period?.tierBasis ?? "lowest",
    };
  }

  return { month, pointValueAed: pv, own, team, company };
}

/** Whose points this request is about: your own, or (finance, audit) anybody's in the organisation. */
async function walletSubject(v: DgoViewer, employeeId?: string) {
  if (employeeId && employeeId !== v.employee?._id) {
    if (!canLookUpWallets(v)) throw httpError("You can see only your own points", 403);
    if (!isObjectId(employeeId)) throw httpError("Unknown employee", 400);
    const e = await Employee.findOne({ _id: employeeId, organization: v.orgId }).select("name department").lean<{ _id: unknown; name: string; department?: unknown }>();
    if (!e) throw httpError("That employee isn't in this organisation", 404);
    return e;
  }
  await assertCanUse(v);
  if (!v.employee) throw httpError("Your login has no employee record, so it has no points", 404);
  return { _id: v.employee._id, name: v.employee.name, department: v.employee.department };
}

const LEDGER_TYPES = ["credit", "reverse", "expire", "reserve", "release", "redeem", "adjust"];

/** GET /dgo-points/wallet */
export async function wallet(v: DgoViewer, q: { employeeId?: string; type?: string; from?: string; to?: string; page?: number; limit?: number }) {
  const subject = await walletSubject(v, q.employeeId);
  const page = Math.max(1, Math.floor(q.page || 1));
  const limit = Math.min(100, Math.max(5, Math.floor(q.limit || 25)));
  const filter: Record<string, unknown> = { employee: subject._id };
  if (q.type && LEDGER_TYPES.includes(q.type)) filter.type = q.type;
  if (q.from || q.to) {
    const day: Record<string, string> = {};
    if (isDay(q.from)) day.$gte = q.from;
    if (isDay(q.to)) day.$lte = q.to;
    if (Object.keys(day).length) filter.day = day;
  }
  const [rows, total, balances, dept, settings] = await Promise.all([
    DgoLedgerEntry.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<LedgerDoc[]>(),
    DgoLedgerEntry.countDocuments(filter),
    balancesOf(subject._id),
    subject.department ? Department.findById(subject.department).select("name").lean<{ name: string }>() : null,
    settingsOn(v.orgId, dayIn(v.tz)),
  ]);
  return {
    employee: { id: String(subject._id), name: subject.name, department: dept?.name ?? null },
    balances,
    pointValueAed: settings.pointValueAed,
    rows: await ledgerRows(rows),
    pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** GET /dgo-points/wallet/lots */
export async function lots(v: DgoViewer, employeeId?: string) {
  const subject = await walletSubject(v, employeeId);
  const rows = await DgoPointLot.find({ employee: subject._id }).sort({ expiresOn: 1 })
    .lean<Array<{ _id: unknown; issued: number; remaining: number; reserved: number; issuedOn: string; expiresOn: string; ruleCode: string | null; description: string }>>();
  return rows.map((l) => ({
    id: String(l._id), issued: l.issued, remaining: l.remaining, reserved: l.reserved,
    issuedOn: l.issuedOn, expiresOn: l.expiresOn, ruleCode: l.ruleCode ?? null, description: l.description,
  }));
}

/** GET /dgo-points/employees — people the viewer may record points for or look up. */
export async function employees(v: DgoViewer, search?: string) {
  const everyone = can(v, "dgoApprovals", "create") || canLookUpWallets(v);
  if (!everyone && !(v.headOf.length && (await isOpen(v.orgId)))) throw httpError("You can't pick other employees", 403);
  const filter: Record<string, unknown> = { organization: v.orgId, status: { $in: ACTIVE_EMPLOYEE_STATUSES } };
  if (!everyone) filter.department = { $in: v.headOf };
  const s = search?.trim();
  if (s) filter.name = { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const rows = await Employee.find(filter).select("name department designation").sort({ name: 1 }).limit(50)
    .lean<Array<{ _id: unknown; name: string; department?: unknown; designation?: string }>>();
  const depts = await Department.find({ _id: { $in: rows.map((r) => r.department).filter(Boolean) } }).select("name").lean<Array<{ _id: unknown; name: string }>>();
  const dname = new Map(depts.map((d) => [String(d._id), d.name]));
  return rows.map((r) => ({ id: String(r._id), name: r.name, department: r.department ? dname.get(String(r.department)) ?? null : null, designation: r.designation ?? null }));
}

/** One earning as the Approvals page shows it, with the allowance it would draw on. */
export async function eventDto(v: DgoViewer, e: EventDoc, budget?: Map<string, { name: string; leftFils: number }>) {
  const key = `${e.month}:${e.department ? String(e.department) : "none"}`;
  const b = budget?.get(key);
  return {
    id: String(e._id),
    employee: { id: String(e.employee), name: e.employeeName, department: e.departmentName ?? null },
    ruleCode: e.ruleCode,
    ruleName: e.ruleName,
    origin: e.origin ?? "recorded",
    evidenceUrl: e.evidenceKey ? publicUrl(e.evidenceKey) : null,
    evidenceName: e.evidenceKey ? e.evidenceName ?? "Attachment" : null,
    points: e.points,
    aed: toAed(e.valueFils),
    day: e.day,
    month: e.month,
    reason: e.reason,
    evidenceNote: e.evidenceNote ?? null,
    kpiKey: e.kpiKey ?? null,
    status: e.status,
    stage: e.stage ?? null,
    chain: e.chain,
    trail: e.trail.map((t) => ({ stage: t.stage ?? null, action: t.action, byName: t.byName ?? null, note: t.note ?? null, at: iso(t.at) })),
    submittedByName: e.submittedByName ?? null,
    createdAt: iso(e.createdAt),
    budget: b ? { departmentName: b.name, leftAed: toAed(Math.max(0, b.leftFils)), afterAed: toAed(b.leftFils - (e.status === "pending" ? e.valueFils : 0)) } : null,
    canDecide: e.status === "pending" && whyCannotDecide(v, e) === null,
    whyNot: e.status === "pending" ? whyCannotDecide(v, e) : null,
    canReverse: e.status === "posted" && can(v, "dgoBudgets", "edit") && String(e.user) !== v.userId && !(v.employee && v.employee._id === String(e.employee)),
  };
}

async function budgetsFor(orgId: string, events: EventDoc[]) {
  const months = [...new Set(events.map((e) => e.month))];
  const periods = await DgoBudgetPeriod.find({ organization: orgId, month: { $in: months } }).select("_id month").lean<Array<{ _id: unknown; month: string }>>();
  const rows = periods.length
    ? await DgoDepartmentBudget.find({ period: { $in: periods.map((p) => p._id) } }).lean<Array<{ month: string; department: unknown; departmentName: string; allocationFils: number; committedFils: number }>>()
    : [];
  return new Map(rows.map((r) => [`${r.month}:${r.department ? String(r.department) : "none"}`, { name: r.departmentName, leftFils: r.allocationFils - r.committedFils }]));
}

/** GET /dgo-points/approvals?tab= */
export async function approvals(v: DgoViewer, tabIn?: string) {
  const tab = tabIn === "waiting" || tabIn === "decided" ? tabIn : "mine";
  const seesAll = can(v, "dgoApprovals", "view") || can(v, "dgoApprovals", "approve") || can(v, "dgoBudgets", "view") || can(v, "dgoBudgets", "approve");
  const open = await isOpen(v.orgId);
  if (!seesAll && !(open && v.headOf.length) && !canRecordAwards(v, open)) throw httpError("You have no DGO approvals", 403);

  // Monthly achiever prizes are paid from the Achievers page, never from here.
  const pendingFilter: Record<string, unknown> = { organization: v.orgId, status: "pending", origin: { $ne: "elite" } };
  if (!seesAll) pendingFilter.$or = [{ department: { $in: v.headOf.map(oid) } }, { submittedBy: oid(v.userId) }];
  const pending = await DgoEarningEvent.find(pendingFilter).sort({ createdAt: 1 }).limit(500).lean<EventDoc[]>();
  const mine = pending.filter((e) => whyCannotDecide(v, e) === null);
  const decidedFilter = { organization: v.orgId, $or: [{ "trail.by": oid(v.userId) }, { submittedBy: oid(v.userId) }], status: { $ne: "pending" } };
  const decidedCount = await DgoEarningEvent.countDocuments(decidedFilter);

  let items: EventDoc[];
  if (tab === "mine") items = mine;
  else if (tab === "waiting") items = pending;
  else items = await DgoEarningEvent.find(decidedFilter).sort({ updatedAt: -1 }).limit(100).lean<EventDoc[]>();
  const budget = await budgetsFor(v.orgId, items);
  return {
    tab,
    counts: { mine: mine.length, waiting: pending.length, decided: decidedCount },
    items: await Promise.all(items.map((e) => eventDto(v, e, budget))),
  };
}

/** GET /dgo-points/audit */
export async function audit(v: DgoViewer, q: { page?: number; limit?: number; action?: string; entity?: string; actor?: string; from?: string; to?: string }) {
  if (!can(v, "dgoAudit", "view")) throw httpError("You can't see the DGO audit log", 403);
  const page = Math.max(1, Math.floor(q.page || 1));
  const limit = Math.min(100, Math.max(10, Math.floor(q.limit || 50)));
  const filter: Record<string, unknown> = { organization: v.orgId };
  if (q.action && /^[a-z_]{2,60}$/.test(q.action)) filter.action = q.action;
  if (q.entity && /^[a-z_]{2,60}$/.test(q.entity)) filter.entity = q.entity;
  const actor = q.actor?.trim();
  if (actor) filter.actorName = { $regex: actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 80), $options: "i" };
  // Days are the organisation's (Dubai) days.
  const at: Record<string, Date> = {};
  if (isDay(q.from)) at.$gte = new Date(Date.parse(`${q.from}T00:00:00Z`) - 4 * 3_600_000);
  if (isDay(q.to)) at.$lt = new Date(Date.parse(`${q.to}T00:00:00Z`) + 20 * 3_600_000);
  if (Object.keys(at).length) filter.createdAt = at;
  const [rows, total, actions, entities] = await Promise.all([
    DgoAuditEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<Array<{ _id: unknown; createdAt: Date; actorName: string | null; action: string; entity: string; entityId: string | null; before: unknown; after: unknown }>>(),
    DgoAuditEntry.countDocuments(filter),
    DgoAuditEntry.distinct("action", { organization: v.orgId }),
    DgoAuditEntry.distinct("entity", { organization: v.orgId }),
  ]);
  return {
    actions: (actions as string[]).sort(),
    entities: (entities as string[]).sort(),
    rows: rows.map((r) => ({ id: String(r._id), at: iso(r.createdAt), actorName: r.actorName, action: r.action, entity: r.entity, entityId: r.entityId, before: r.before, after: r.after })),
    pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/* ───────────── Phase 2: nominations ───────────── */

/** GET /dgo-points/nominations?tab=sent|received */
export async function nominationsView(v: DgoViewer, tabIn?: string) {
  await assertCanUse(v);
  const tab = tabIn === "received" ? "received" : "sent";
  const today = dayIn(v.tz);
  const month = today.slice(0, 7);
  const [program, settings, rules] = await Promise.all([programSettings(v.orgId), settingsOn(v.orgId, today), rulesOn(v.orgId, today)]);
  const sentFilter = { organization: v.orgId, submittedBy: oid(v.userId), origin: "nomination" };
  const receivedFilter = v.employee ? { organization: v.orgId, employee: oid(v.employee._id), origin: "nomination", status: "posted" } : null;
  const [used, sentCount, receivedCount] = await Promise.all([
    DgoEarningEvent.countDocuments({ ...sentFilter, nominationMonth: month }),
    DgoEarningEvent.countDocuments(sentFilter),
    receivedFilter ? DgoEarningEvent.countDocuments(receivedFilter) : 0,
  ]);
  const rows = tab === "sent"
    ? await DgoEarningEvent.find(sentFilter).sort({ createdAt: -1 }).limit(100).lean<EventDoc[]>()
    : receivedFilter ? await DgoEarningEvent.find(receivedFilter).sort({ postedAt: -1 }).limit(100).lean<EventDoc[]>() : [];
  return {
    tab,
    limit: program.nominationsPerMonth,
    usedThisMonth: used,
    left: Math.max(0, program.nominationsPerMonth - used),
    rules: rules.filter((r) => r.active && r.source === "award").map((r) => {
      const d = ruleDto(r, settings.pointValueAed);
      return { code: d.code, name: d.name, description: d.description, points: d.points, aed: d.aed, needsEvidence: d.needsEvidence, chain: nominationChain(d.chain), capExempt: d.capExempt };
    }),
    counts: { sent: sentCount, received: receivedCount },
    items: await Promise.all(rows.map((e) => eventDto(v, e))),
  };
}

/** GET /dgo-points/colleagues?search= — anybody current in the organisation but you, to nominate. */
export async function colleagues(v: DgoViewer, search?: string) {
  await assertCanUse(v);
  const filter: Record<string, unknown> = { organization: v.orgId, status: { $in: ACTIVE_EMPLOYEE_STATUSES } };
  if (v.employee) filter._id = { $ne: oid(v.employee._id) };
  const s = search?.trim();
  if (s) filter.name = { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const rows = await Employee.find(filter).select("name department designation photo user").sort({ name: 1 }).limit(50)
    .lean<Array<{ _id: unknown; name: string; department?: unknown; designation?: string; photo?: string; user?: unknown }>>();
  const depts = await Department.find({ _id: { $in: rows.map((r) => r.department).filter(Boolean) } }).select("name").lean<Array<{ _id: unknown; name: string }>>();
  const dname = new Map(depts.map((d) => [String(d._id), d.name]));
  return rows
    .filter((r) => !(r.user && String(r.user) === v.userId))
    .map((r) => ({
      id: String(r._id), name: r.name, department: r.department ? dname.get(String(r.department)) ?? null : null,
      designation: r.designation ?? null, photoUrl: r.photo ? publicUrl(r.photo) : null,
    }));
}

