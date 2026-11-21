import type { Model } from "mongoose";
import { DgoLedgerEntry } from "../../models/DgoLedgerEntry.js";
import { DgoWallet } from "../../models/DgoWallet.js";
import { DgoBudgetPeriod } from "../../models/DgoBudgetPeriod.js";
import { DgoDepartmentBudget } from "../../models/DgoDepartmentBudget.js";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { DgoRedemption } from "../../models/DgoRedemption.js";
import { DgoAdjustment } from "../../models/DgoAdjustment.js";
import { DgoBudgetOverride } from "../../models/DgoBudgetOverride.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { ELITE_RULE_PREFIX } from "./dgoDefaults.js";
import { dayIn, isMonth, pointsToFils, previousMonth, toAed } from "./dgoMath.js";
import { httpError } from "./dgoErrors.js";
import { settingsOn } from "./dgoSettingsService.js";
import { equationHolds, monthRange, pointTotals, type PointTotals, type Snapshot } from "./dgoCloseService.js";
import { can, oid, type DgoViewer } from "./dgoAccess.js";

/**
 * Points Reports: the management view, the reconciliation, and CSV exports.
 * Read-only. Finance (dgoBudgets) and audit (dgoAudit) may read; exporting needs
 * the export permission of either.
 */

export const canViewReports = (v: DgoViewer) => can(v, "dgoBudgets", "view") || can(v, "dgoAudit", "view");
export const canExportReports = (v: DgoViewer) => can(v, "dgoBudgets", "export") || can(v, "dgoAudit", "export");

function monthOf(v: DgoViewer, m?: string) {
  const thisMonth = dayIn(v.tz).slice(0, 7);
  const month = m || thisMonth;
  if (!isMonth(month)) throw httpError("month must be YYYY-MM", 400);
  if (month > thisMonth) throw httpError("That month hasn't started", 400);
  return month;
}

async function pointValueFor(orgId: string, month: string) {
  const p = await DgoBudgetPeriod.findOne({ organization: orgId, month }).select("pointValueAed").lean<{ pointValueAed: number }>();
  return p?.pointValueAed ?? (await settingsOn(orgId, `${month}-01`).catch(() => null))?.pointValueAed ?? 0.05;
}

const daysSince = (d: Date | null | undefined, now: number) => (d ? Math.floor((now - new Date(d).getTime()) / 86_400_000) : null);

/** GET /dgo-points/reports/overview?month= */
export async function reportsOverview(v: DgoViewer, monthIn?: string) {
  if (!canViewReports(v)) throw httpError("You can't see DGO Points reports", 403);
  const month = monthOf(v, monthIn);
  const months: string[] = [];
  for (let m = month, i = 0; i < 6; i++, m = previousMonth(m)) months.unshift(m);
  const pv = await pointValueFor(v.orgId, month);
  const periods = await DgoBudgetPeriod.find({ organization: v.orgId, month: { $in: months } }).select("month status").lean<Array<{ month: string; status: string }>>();
  const closed = new Set(periods.filter((p) => p.status === "closed").map((p) => p.month));
  const trend = [];
  for (const m of months) {
    const t = (await pointTotals(v.orgId, m)).get("all")!;
    trend.push({ month: m, ...t, liabilityAed: toAed(pointsToFils(t.closing, pv)), closed: closed.has(m) });
  }

  const period = await DgoBudgetPeriod.findOne({ organization: v.orgId, month }).select("_id").lean<{ _id: unknown }>();
  const [rows, perDept, byRule, top, rewards] = await Promise.all([
    period ? DgoDepartmentBudget.find({ period: period._id }).sort({ group: -1, departmentName: 1 }).lean<Array<{ department: unknown; departmentName: string; group: "revenue" | "other"; allocationFils: number; committedFils: number }>>() : [],
    DgoEarningEvent.aggregate<{ _id: unknown; p: number }>([
      { $match: { organization: oid(v.orgId), month, status: "posted", origin: { $ne: "elite" } } },
      { $group: { _id: "$department", p: { $sum: "$points" } } },
    ]),
    DgoEarningEvent.aggregate<{ _id: { code: string; name: string }; n: number; p: number }>([
      { $match: { organization: oid(v.orgId), month, status: "posted" } },
      { $group: { _id: { code: "$ruleCode", name: "$ruleName" }, n: { $sum: 1 }, p: { $sum: "$points" } } },
      { $sort: { p: -1 } },
    ]),
    DgoLedgerEntry.aggregate<{ _id: unknown; p: number }>([
      { $match: { organization: oid(v.orgId), month, type: { $in: ["credit", "reverse"] }, ruleCode: { $not: new RegExp(`^${ELITE_RULE_PREFIX}`) } } },
      { $group: { _id: "$employee", p: { $sum: "$delta" } } },
      { $match: { p: { $gt: 0 } } },
      { $sort: { p: -1 } },
      { $limit: 10 },
    ]),
    (() => {
      const { from, to } = monthRange(month);
      return DgoRedemption.aggregate<{ _id: string; n: number; p: number }>([
        { $match: { organization: oid(v.orgId), status: { $in: ["reserved", "approved", "fulfilled"] }, createdAt: { $gte: from, $lt: to } } },
        { $group: { _id: "$rewardName", n: { $sum: 1 }, p: { $sum: "$points" } } },
        { $sort: { n: -1 } },
      ]);
    })(),
  ]);
  const deptPoints = new Map(perDept.map((d) => [d._id ? String(d._id) : "none", d.p]));
  const people = top.length ? await Employee.find({ _id: { $in: top.map((t) => t._id) } }).select("name department").lean<Array<{ _id: unknown; name: string; department?: unknown }>>() : [];
  const depts = await Department.find({ _id: { $in: people.map((p) => p.department).filter(Boolean) } }).select("name").lean<Array<{ _id: unknown; name: string }>>();
  const dname = new Map(depts.map((d) => [String(d._id), d.name]));
  const byId = new Map(people.map((p) => [String(p._id), p]));

  const now = Date.now();
  const oldest = async (model: Model<{ createdAt: Date }>, filter: Record<string, unknown>) => {
    const [count, first] = await Promise.all([
      model.countDocuments(filter),
      model.findOne(filter).sort({ createdAt: 1 }).select("createdAt").lean<{ createdAt: Date } | null>(),
    ]);
    return { count, oldestDays: daysSince(first?.createdAt, now) };
  };
  const asModel = (m: unknown) => m as Model<{ createdAt: Date }>;
  const waiting = {
    earnings: await oldest(asModel(DgoEarningEvent), { organization: v.orgId, status: "pending", origin: { $ne: "elite" } }),
    redemptions: await oldest(asModel(DgoRedemption), { organization: v.orgId, status: { $in: ["reserved", "approved"] } }),
    adjustments: await oldest(asModel(DgoAdjustment), { organization: v.orgId, status: "pending" }),
    overrides: await oldest(asModel(DgoBudgetOverride), { organization: v.orgId, status: "pending" }),
  };

  return {
    month,
    pointValueAed: pv,
    trend,
    byDepartment: rows.map((r) => ({
      name: r.departmentName, group: r.group, allocationAed: toAed(r.allocationFils), committedAed: toAed(r.committedFils),
      usedPct: r.allocationFils > 0 ? Math.round((r.committedFils / r.allocationFils) * 100) : 0,
      points: deptPoints.get(r.department ? String(r.department) : "none") ?? 0,
    })),
    byRule: byRule.map((r) => ({ code: r._id.code, name: r._id.name, count: r.n, points: r.p })),
    topEarners: top.map((t) => {
      const p = byId.get(String(t._id));
      return { employeeId: String(t._id), name: p?.name ?? "Unknown", department: p?.department ? dname.get(String(p.department)) ?? null : null, points: t.p };
    }),
    rewards: rewards.map((r) => ({ name: r._id, redeemed: r.n, points: r.p })),
    waiting,
  };
}

/** Every wallet against the ledger, now (whole organisation). */
async function walletCheck(orgId: string) {
  const [ledger, wallets] = await Promise.all([
    DgoLedgerEntry.aggregate<{ _id: unknown; a: number; h: number }>([
      { $match: { organization: oid(orgId) } },
      { $group: { _id: "$employee", a: { $sum: "$delta" }, h: { $sum: { $ifNull: ["$reservedDelta", 0] } } } },
    ]),
    DgoWallet.find({ organization: orgId }).select("employee available reserved").lean<Array<{ employee: unknown; available: number; reserved: number }>>(),
  ]);
  const byEmp = new Map(wallets.map((w) => [String(w.employee), w]));
  const drifted: Array<{ employeeId: string; ledger: number; wallet: number }> = [];
  let ledgerOutstanding = 0, walletOutstanding = 0;
  const seen = new Set<string>();
  for (const l of ledger) {
    const k = String(l._id);
    seen.add(k);
    const w = byEmp.get(k);
    ledgerOutstanding += l.a + l.h;
    walletOutstanding += (w?.available ?? 0) + (w?.reserved ?? 0);
    if (!w || w.available !== l.a || w.reserved !== l.h) drifted.push({ employeeId: k, ledger: l.a + l.h, wallet: (w?.available ?? 0) + (w?.reserved ?? 0) });
  }
  for (const w of wallets) {
    if (seen.has(String(w.employee))) continue;
    walletOutstanding += w.available + w.reserved;
    if (w.available || w.reserved) drifted.push({ employeeId: String(w.employee), ledger: 0, wallet: w.available + w.reserved });
  }
  const names = drifted.length ? await Employee.find({ _id: { $in: drifted.map((d) => d.employeeId) } }).select("name").lean<Array<{ _id: unknown; name: string }>>() : [];
  const nm = new Map(names.map((n) => [String(n._id), n.name]));
  return {
    ledgerOutstanding, walletOutstanding,
    matches: drifted.length === 0 && ledgerOutstanding === walletOutstanding,
    drifted: drifted.slice(0, 200).map((d) => ({ ...d, name: nm.get(d.employeeId) ?? "Unknown" })),
  };
}

/** People's totals for a month, with names and departments, by name. */
async function peopleTotals(orgId: string, month: string) {
  const per = await pointTotals(orgId, month, { perEmployee: true });
  const ids = [...per.keys()];
  const people = ids.length ? await Employee.find({ _id: { $in: ids } }).select("name department").lean<Array<{ _id: unknown; name: string; department?: unknown }>>() : [];
  const depts = await Department.find({ _id: { $in: people.map((p) => p.department).filter(Boolean) } }).select("name").lean<Array<{ _id: unknown; name: string }>>();
  const dname = new Map(depts.map((d) => [String(d._id), d.name]));
  const byId = new Map(people.map((p) => [String(p._id), p]));
  return ids
    .map((id) => {
      const p = byId.get(id);
      return { employeeId: id, name: p?.name ?? "Unknown", department: p?.department ? dname.get(String(p.department)) ?? null : null, ...per.get(id)! };
    })
    .filter((r) => r.opening || r.closing || r.issued || r.spent || r.reversed || r.expired || r.adjusted)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** GET /dgo-points/reports/reconciliation?month= */
export async function reconciliation(v: DgoViewer, monthIn?: string) {
  if (!canViewReports(v)) throw httpError("You can't see DGO Points reports", 403);
  const month = monthOf(v, monthIn);
  const [totalsMap, pv, period, wallets, people] = await Promise.all([
    pointTotals(v.orgId, month),
    pointValueFor(v.orgId, month),
    DgoBudgetPeriod.findOne({ organization: v.orgId, month }).select("status snapshot").lean<{ status: string; snapshot?: Snapshot | null }>(),
    walletCheck(v.orgId),
    peopleTotals(v.orgId, month),
  ]);
  const totals = totalsMap.get("all")!;
  const closed = period?.status === "closed";
  const snap = period?.snapshot?.points;
  const same = (a: PointTotals, b: PointTotals) => (Object.keys(a) as Array<keyof PointTotals>).every((k) => a[k] === b[k]);
  return {
    month,
    closed,
    totals,
    liabilityAed: toAed(pointsToFils(totals.closing, pv)),
    equationHolds: equationHolds(totals),
    snapshotMatches: closed && snap ? same(totals, snap) : null,
    wallets,
    people: people.slice(0, 2000),
  };
}

/* ───────────── CSV ───────────── */

/** One CSV cell: quoted when it needs to be, and text that a spreadsheet would run as a formula made inert. */
const cell = (x: unknown) => {
  let s = x == null ? "" : String(x);
  if (typeof x === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** GET /dgo-points/reports/export?kind=&month= → { filename, body } */
export async function exportCsv(v: DgoViewer, kindIn: string | undefined, monthIn?: string) {
  if (!canExportReports(v)) throw httpError("You can't export DGO Points reports", 403);
  const month = monthOf(v, monthIn);
  const kind = ["ledger", "wallets", "redemptions", "reconciliation"].includes(kindIn ?? "") ? kindIn! : "ledger";
  const emps = async (ids: unknown[]) => {
    const people = ids.length ? await Employee.find({ _id: { $in: ids } }).select("name employeeCode department status").lean<Array<{ _id: unknown; name: string; employeeCode?: string; department?: unknown; status?: string }>>() : [];
    const depts = await Department.find({ _id: { $in: people.map((p) => p.department).filter(Boolean) } }).select("name").lean<Array<{ _id: unknown; name: string }>>();
    const dname = new Map(depts.map((d) => [String(d._id), d.name]));
    return new Map(people.map((p) => [String(p._id), { ...p, departmentName: p.department ? dname.get(String(p.department)) ?? "" : "" }]));
  };
  let body: string;
  if (kind === "ledger") {
    const rows = await DgoLedgerEntry.find({ organization: v.orgId, month }).sort({ createdAt: 1 }).limit(50_000)
      .lean<Array<{ createdAt: Date; day: string; employee: unknown; type: string; delta: number; reservedDelta?: number; ruleCode?: string | null; description: string; createdByName?: string | null }>>();
    const e = await emps([...new Set(rows.map((r) => String(r.employee)))]);
    body = csv(["When", "Day", "Employee", "Code", "Department", "Type", "Points", "Held change", "Rule", "Description", "By"],
      rows.map((r) => { const p = e.get(String(r.employee)); return [new Date(r.createdAt).toISOString(), r.day, p?.name ?? "", p?.employeeCode ?? "", p?.departmentName ?? "", r.type, r.delta, r.reservedDelta ?? 0, r.ruleCode ?? "", r.description, r.createdByName ?? ""]; }));
  } else if (kind === "wallets") {
    const rows = await DgoWallet.find({ organization: v.orgId }).lean<Array<{ employee: unknown; available: number; reserved: number; lifetimeEarned: number; redeemed: number; expired: number; reversed: number }>>();
    const e = await emps(rows.map((r) => r.employee));
    const pv = await pointValueFor(v.orgId, month);
    body = csv(["Employee", "Code", "Department", "Status", "Can spend", "Held", "Earned (all time)", "Spent", "Expired", "Taken back", "Outstanding AED"],
      rows.map((r) => { const p = e.get(String(r.employee)); return [p?.name ?? "", p?.employeeCode ?? "", p?.departmentName ?? "", p?.status ?? "", r.available, r.reserved, r.lifetimeEarned, r.redeemed, r.expired, r.reversed, toAed(pointsToFils(r.available + r.reserved, pv)).toFixed(2)]; })
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  } else if (kind === "redemptions") {
    const { from, to } = monthRange(month);
    const rows = await DgoRedemption.find({ organization: v.orgId, status: { $ne: "reserving" }, $or: [{ createdAt: { $gte: from, $lt: to } }, { fulfilledAt: { $gte: from, $lt: to } }] }).sort({ createdAt: 1 })
      .lean<Array<{ createdAt: Date; fulfilledAt?: Date | null; employeeName: string; departmentName?: string | null; rewardName: string; points: number; costFils?: number | null; status: string; purchaseStatus?: string; purchaseRef?: string | null; note?: string | null; fulfilmentNote?: string | null }>>();
    body = csv(["Asked", "Delivered", "Employee", "Department", "Reward", "Points", "Cost AED", "Status", "Purchase", "Expense", "Employee note", "HR note"],
      rows.map((r) => [new Date(r.createdAt).toISOString(), r.fulfilledAt ? new Date(r.fulfilledAt).toISOString() : "", r.employeeName, r.departmentName ?? "", r.rewardName, r.points, r.costFils != null ? toAed(r.costFils).toFixed(2) : "", r.status, r.purchaseStatus ?? "not_needed", r.purchaseRef ?? "", r.note ?? "", r.fulfilmentNote ?? ""]));
  } else {
    const people = await peopleTotals(v.orgId, month);
    const t = (await pointTotals(v.orgId, month)).get("all")!;
    body = csv(["Employee", "Department", "Opening", "Issued", "Spent", "Taken back", "Expired", "Adjusted", "Closing"],
      [...people.map((p) => [p.name, p.department ?? "", p.opening, p.issued, p.spent, p.reversed, p.expired, p.adjusted, p.closing]),
        ["Total", "", t.opening, t.issued, t.spent, t.reversed, t.expired, t.adjusted, t.closing]]);
  }
  return { filename: `dgo-${kind}-${month}.csv`, body };
}
