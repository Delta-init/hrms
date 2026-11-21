import type { Types } from "mongoose";
import { DgoProgram } from "../../models/DgoProgram.js";
import { DgoPointLot } from "../../models/DgoPointLot.js";
import { DgoWallet } from "../../models/DgoWallet.js";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { DgoRedemption } from "../../models/DgoRedemption.js";
import { DgoAdjustment } from "../../models/DgoAdjustment.js";
import { DgoBudgetOverride } from "../../models/DgoBudgetOverride.js";
import { DgoAuditEntry } from "../../models/DgoAuditEntry.js";
import { Employee } from "../../models/Employee.js";
import { Organization } from "../../models/Organization.js";
import { notify } from "../notificationService.js";
import { ACTIVE_EMPLOYEE_STATUSES, type DgoStage } from "./dgoDefaults.js";
import { dayIn } from "./dgoMath.js";
import { expireLot, rebuildWallet, type Actor } from "./dgoLedgerService.js";
import { giveBackAs } from "./dgoRewardService.js";
import { inTransaction } from "./dgoTxn.js";
import { approverUserIds, usersWith } from "./dgoAccess.js";

/**
 * The nightly DGO Points job, per organisation:
 *
 *  1. leavers — somebody whose status is now resigned or terminated: requests
 *     still waiting are rejected, open redemptions cancelled (points back, stock
 *     back), then every spendable point expires ("Left the company"); a reward
 *     already handed over is never taken back;
 *  2. expiry — batches past their expiry day lose what is spendable; the part held
 *     for a redemption in progress stays until that redemption ends;
 *  3. warnings — people with points expiring within 30 days, and again within 7;
 *  4. nudges — approvers with anything waiting more than two days, once a day;
 *  5. drift — every wallet recounted from the ledger; finance told if any moved.
 *
 * Runs once a day per organisation even with several servers: the run claims the
 * day on the program row first. Every step is repeat-safe on its own.
 */

const ACTOR: Actor = { userId: null, name: "DGO Points (nightly)" };
const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export interface DailyReport {
  orgId: string;
  day: string;
  leavers: number;
  leaverPoints: number;
  expiredPoints: number;
  warned: number;
  nudged: number;
  recounted: number;
}

async function audit(orgId: string, action: string, entityId: string | null, after: unknown) {
  await DgoAuditEntry.create({ organization: orgId, actor: null, actorName: ACTOR.name, action, entity: "nightly", entityId, before: null, after }).catch(() => undefined);
}

type LotDoc = { _id: Types.ObjectId; organization: unknown; employee: Types.ObjectId; remaining: number; reserved: number; description?: string; expiresOn: string };

async function expireOne(lot: LotDoc, today: string, why: string): Promise<number> {
  return inTransaction((session) => expireLot(lot, today, why, ACTOR, session));
}

/** One organisation's nightly run. `force` skips the once-a-day claim (the check script). */
export async function runDgoDaily(orgId: string, opts: { now?: Date; force?: boolean } = {}): Promise<DailyReport | null> {
  const org = await Organization.findById(orgId).select("timeZone").lean<{ timeZone?: string }>();
  const tz = org?.timeZone || "Asia/Dubai";
  const now = opts.now ?? new Date();
  const today = dayIn(tz, now);
  if (!opts.force) {
    const claimed = await DgoProgram.updateOne({ organization: orgId, lastDailyRun: { $ne: today } }, { $set: { lastDailyRun: today } });
    if (!claimed.modifiedCount) return null;
  }
  const report: DailyReport = { orgId, day: today, leavers: 0, leaverPoints: 0, expiredPoints: 0, warned: 0, nudged: 0, recounted: 0 };

  /* 1. Leavers */
  const [withLots, withRedemptions, withRequests] = await Promise.all([
    DgoPointLot.distinct("employee", { organization: orgId, remaining: { $gt: 0 } }),
    DgoRedemption.distinct("employee", { organization: orgId, status: { $in: ["reserved", "approved"] } }),
    DgoEarningEvent.distinct("employee", { organization: orgId, status: "pending" }),
  ]);
  const touched = [...new Set([...withLots, ...withRedemptions, ...withRequests].map(String))];
  const leavers = touched.length
    ? await Employee.find({ _id: { $in: touched }, status: { $nin: ACTIVE_EMPLOYEE_STATUSES } }).select("_id name status").lean<Array<{ _id: Types.ObjectId; name: string; status: string }>>()
    : [];
  for (const emp of leavers) {
    const note = "Left the company";
    const rejected = await DgoEarningEvent.updateMany(
      { organization: orgId, employee: emp._id, status: "pending" },
      { $set: { status: "rejected", stage: null }, $push: { trail: { stage: null, action: "rejected", by: null, byName: ACTOR.name, note, at: new Date() } } }
    );
    const open = await DgoRedemption.find({ organization: orgId, employee: emp._id, status: { $in: ["reserved", "approved"] } }).select("_id").lean<Array<{ _id: Types.ObjectId }>>();
    for (const r of open) await giveBackAs(ACTOR, today, r, ["reserved", "approved"], "cancelled", note);
    let pts = 0;
    const lots = await DgoPointLot.find({ organization: orgId, employee: emp._id, $expr: { $gt: ["$remaining", "$reserved"] } }).lean<LotDoc[]>();
    for (const lot of lots) pts += await expireOne(lot, today, note);
    if (pts || open.length || rejected.modifiedCount) {
      report.leavers++;
      report.leaverPoints += pts;
      await audit(orgId, "leaver_points_expired", String(emp._id), { employee: emp.name, status: emp.status, pointsExpired: pts, redemptionsCancelled: open.length, requestsRejected: rejected.modifiedCount });
    }
  }

  /* 2. Expiry */
  const due = await DgoPointLot.find({ organization: orgId, expiresOn: { $lt: today }, $expr: { $gt: ["$remaining", "$reserved"] } }).lean<LotDoc[]>();
  const expiredBy = new Map<string, number>();
  for (const lot of due) {
    const x = await expireOne(lot, today, "Expired");
    if (x) expiredBy.set(String(lot.employee), (expiredBy.get(String(lot.employee)) ?? 0) + x);
    report.expiredPoints += x;
  }
  if (expiredBy.size) {
    const emps = await Employee.find({ _id: { $in: [...expiredBy.keys()] } }).select("user").lean<Array<{ _id: unknown; user?: unknown }>>();
    for (const e of emps) {
      await notify({ users: [e.user], kind: "system", tone: "negative", organization: orgId, title: `${expiredBy.get(String(e._id))!.toLocaleString("en")} DGO Points expired`, body: "Points last 12 months from the day they were earned", href: "/dgo-points/wallet" });
    }
  }

  /* 3. Warnings: within 30 days, then within 7 */
  for (const w of [{ within: 7, flag: "warned7" as const }, { within: 30, flag: "warned30" as const }]) {
    const lots = await DgoPointLot.find({
      organization: orgId, expiresOn: { $gte: today, $lte: addDays(today, w.within) }, [w.flag]: { $ne: true },
      $expr: { $gt: ["$remaining", "$reserved"] },
    }).lean<Array<LotDoc & { _id: Types.ObjectId }>>();
    if (!lots.length) continue;
    const byEmp = new Map<string, { points: number; first: string }>();
    for (const l of lots) {
      const cur = byEmp.get(String(l.employee)) ?? { points: 0, first: l.expiresOn };
      cur.points += l.remaining - l.reserved;
      if (l.expiresOn < cur.first) cur.first = l.expiresOn;
      byEmp.set(String(l.employee), cur);
    }
    // A 7-day warning also counts as the 30-day one.
    await DgoPointLot.updateMany({ _id: { $in: lots.map((l) => l._id) } }, { $set: w.flag === "warned7" ? { warned7: true, warned30: true } : { warned30: true } });
    const emps = await Employee.find({ _id: { $in: [...byEmp.keys()] }, status: { $in: ACTIVE_EMPLOYEE_STATUSES } }).select("user").lean<Array<{ _id: unknown; user?: unknown }>>();
    for (const e of emps) {
      const x = byEmp.get(String(e._id))!;
      await notify({ users: [e.user], kind: "reminder", organization: orgId, title: `${x.points.toLocaleString("en")} DGO Points expire by ${x.first}`, body: "Spend them in the rewards store before then", href: "/dgo-points/rewards" });
      report.warned++;
    }
  }

  /* 4. Nudges: anything waiting more than two days */
  const before = new Date(now.getTime() - 2 * DAY);
  const counts = new Map<string, number>();
  const bump = (users: string[], n = 1) => { for (const u of users) counts.set(u, (counts.get(u) ?? 0) + n); };
  const waitingEvents = await DgoEarningEvent.find({ organization: orgId, status: "pending", origin: { $ne: "elite" }, createdAt: { $lt: before } }).select("stage user").lean<Array<{ stage: DgoStage | null; user: unknown }>>();
  const stageCache = new Map<string, string[]>();
  for (const e of waitingEvents) {
    const k = e.stage === "head" ? `head:${String(e.user)}` : String(e.stage);
    if (!stageCache.has(k)) stageCache.set(k, await approverUserIds(orgId, e.stage, e.user).catch(() => []));
    bump(stageCache.get(k)!);
  }
  const [oldRedemptions, oldAdjustments, oldOverrides] = await Promise.all([
    DgoRedemption.countDocuments({ organization: orgId, status: "reserved", createdAt: { $lt: before } }),
    DgoAdjustment.countDocuments({ organization: orgId, status: "pending", createdAt: { $lt: before } }),
    DgoBudgetOverride.countDocuments({ organization: orgId, status: "pending", createdAt: { $lt: before } }),
  ]);
  if (oldRedemptions) bump(await usersWith(orgId, "dgoRewards", "approve").catch(() => []), oldRedemptions);
  if (oldAdjustments + oldOverrides) bump(await usersWith(orgId, "dgoBudgets", "approve").catch(() => []), oldAdjustments + oldOverrides);
  for (const [user, n] of counts) {
    await notify({ users: [user], kind: "reminder", organization: orgId, title: `${n} DGO Points item${n === 1 ? "" : "s"} waiting over 2 days for you`, body: "Approvals, rewards or finance controls", href: "/dgo-points/approvals" });
    report.nudged++;
  }

  /* 5. Drift: every wallet against its ledger */
  const wallets = await DgoWallet.find({ organization: orgId }).select("employee").lean<Array<{ employee: unknown }>>();
  const drifted: string[] = [];
  for (const w of wallets) if ((await rebuildWallet(orgId, w.employee)).drifted) drifted.push(String(w.employee));
  report.recounted = drifted.length;
  if (drifted.length) {
    await audit(orgId, "wallets_recounted", null, { employees: drifted });
    const finance = await usersWith(orgId, "dgoBudgets", "approve").catch(() => []);
    await notify({ users: finance, kind: "system", tone: "negative", organization: orgId, title: `${drifted.length} DGO wallet${drifted.length === 1 ? " was" : "s were"} recounted from the points log`, body: "The cached balance had drifted; the ledger is the record. See Points Reports → Reconciliation.", href: "/dgo-points/reports?tab=reconciliation" });
  }

  if (report.leavers || report.expiredPoints || report.recounted) await audit(orgId, "nightly_run", today, report);
  return report;
}

/** Every organisation with DGO Points set up. */
export async function runDgoDailyAll(now = new Date()): Promise<DailyReport[]> {
  const orgs = await DgoProgram.distinct("organization");
  const out: DailyReport[] = [];
  for (const o of orgs) {
    if (!o) continue;
    try {
      const r = await runDgoDaily(String(o), { now });
      if (r) out.push(r);
    } catch (e) {
      console.error(`dgo-points nightly: ${String(o)} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
