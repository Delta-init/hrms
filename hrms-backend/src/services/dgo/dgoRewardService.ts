import mongoose, { type Types } from "mongoose";
import { DgoReward } from "../../models/DgoReward.js";
import { DgoRedemption } from "../../models/DgoRedemption.js";
import { DgoWallet } from "../../models/DgoWallet.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { Procurement } from "../../models/Procurement.js";
import { publicUrl } from "../uploadService.js";
import { notify } from "../notificationService.js";
import { ACTIVE_EMPLOYEE_STATUSES } from "./dgoDefaults.js";
import { dayIn, pointsToFils, toAed, toFils } from "./dgoMath.js";
import { httpError, isDuplicateKey } from "./dgoErrors.js";
import { settingsOn } from "./dgoSettingsService.js";
import { inTransaction } from "./dgoTxn.js";
import { dgoAudit } from "./dgoAudit.js";
import { redeemPoints, releasePoints, reservePoints, type Actor, type Holding, type Spend } from "./dgoLedgerService.js";
import { assertCanUse, can, canFulfil, canManageRewards, canSeeFulfilment, isObjectId, usersWith, type DgoViewer } from "./dgoAccess.js";

/**
 * The DGO Points rewards store: HR's catalogue, and employees spending points.
 *
 * Asking for a reward holds the points at once (reservePoints: one conditional
 * update on the wallet, so it can never go below zero, then the batches that
 * expire first). HR approves, then marks it delivered, which spends the held
 * points; the employee may cancel while it waits, HR may reject it until it is
 * delivered, and either gives the points back exactly once.
 */

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");
const actorOf = (v: DgoViewer): Actor => ({ userId: v.userId, name: v.name });
const trailEntry = (action: string, v: { userId: string | null; name: string | null }, note: string | null = null) =>
  ({ action, by: v.userId, byName: v.name, note, at: new Date() });

/* ───────────── catalogue ───────────── */

interface RewardDoc {
  _id: Types.ObjectId;
  organization: unknown;
  name: string;
  description: string;
  category: string;
  photoKey: string | null;
  points: number;
  costFils: number | null;
  stockMode: "unlimited" | "limited";
  stock: number | null;
  status: "active" | "hidden" | "archived";
  buyPerRedemption?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function rewardDto(r: RewardDoc, o: { manager: boolean; available: number; pointValueAed: number; redeemedCount?: number }) {
  const outOfStock = r.stockMode === "limited" && (r.stock ?? 0) <= 0;
  return {
    id: String(r._id),
    name: r.name,
    description: r.description ?? "",
    category: r.category,
    photoUrl: r.photoKey ? publicUrl(r.photoKey) : null,
    photoKey: o.manager ? r.photoKey ?? null : null,
    points: r.points,
    aed: toAed(pointsToFils(r.points, o.pointValueAed)),
    costAed: o.manager && r.costFils != null ? toAed(r.costFils) : null,
    stockMode: r.stockMode,
    stock: r.stockMode === "limited" ? r.stock ?? 0 : null,
    status: r.status,
    affordable: !outOfStock && o.available >= r.points,
    short: Math.max(0, r.points - o.available),
    redeemedCount: o.manager ? o.redeemedCount ?? 0 : 0,
    buyPerRedemption: o.manager ? Boolean(r.buyPerRedemption) : false,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

async function spendable(v: DgoViewer): Promise<number> {
  if (!v.employee) return 0;
  const w = await DgoWallet.findOne({ employee: v.employee._id }).select("available").lean<{ available: number }>();
  return w?.available ?? 0;
}

/** GET /dgo-points/rewards?manage=1 */
export async function rewardsView(v: DgoViewer, manage: boolean) {
  const manager = manage && canManageRewards(v);
  if (manage && !manager) throw httpError("You can't manage the rewards catalogue", 403);
  if (!manager) await assertCanUse(v);
  const today = dayIn(v.tz);
  const [settings, available, rows] = await Promise.all([
    settingsOn(v.orgId, today),
    spendable(v),
    DgoReward.find({ organization: v.orgId, status: manager ? { $in: ["active", "hidden"] } : "active" })
      .sort({ status: 1, points: 1, name: 1 }).lean<RewardDoc[]>(),
  ]);
  let counts = new Map<string, number>();
  if (manager && rows.length) {
    const agg = await DgoRedemption.aggregate<{ _id: unknown; n: number }>([
      { $match: { reward: { $in: rows.map((r) => r._id) }, status: { $in: ["reserved", "approved", "fulfilled"] } } },
      { $group: { _id: "$reward", n: { $sum: 1 } } },
    ]);
    counts = new Map(agg.map((a) => [String(a._id), a.n]));
  }
  const rewards = rows.map((r) => rewardDto(r, { manager, available, pointValueAed: settings.pointValueAed, redeemedCount: counts.get(String(r._id)) }));
  return {
    rewards,
    available,
    minRedemption: settings.minRedemption,
    pointValueAed: settings.pointValueAed,
    categories: [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b)),
  };
}

export interface RewardInput {
  name: string;
  description?: string;
  category: string;
  photoKey?: string | null;
  points: number;
  costAed?: number | null;
  stockMode: "unlimited" | "limited";
  stock?: number | null;
  status: "active" | "hidden";
  buyPerRedemption?: boolean;
}

async function cleanReward(v: DgoViewer, input: RewardInput, current?: Partial<RewardDoc>) {
  const settings = await settingsOn(v.orgId, dayIn(v.tz));
  if (input.points < settings.minRedemption) throw httpError(`A reward costs at least ${settings.minRedemption.toLocaleString("en")} points (the minimum redemption)`, 400);
  const photoKey = input.photoKey?.trim() || null;
  if (photoKey && !photoKey.startsWith(`${v.orgId}/dgo-rewards/`)) throw httpError("Upload the photo again", 400);
  if (input.stockMode === "limited" && (input.stock == null || input.stock < 0)) throw httpError("Say how many are in stock", 400);
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    category: input.category.trim(),
    photoKey,
    points: input.points,
    costFils: input.costAed != null ? toFils(input.costAed) : null,
    stockMode: input.stockMode,
    stock: input.stockMode === "limited" ? input.stock! : null,
    status: input.status,
    // Bought one at a time unless said otherwise: on by default for a reward that costs the office something.
    buyPerRedemption: input.buyPerRedemption ?? current?.buyPerRedemption ?? (input.costAed != null && input.costAed > 0),
  };
}

const auditShape = (r: Partial<RewardDoc> | null) => r && ({
  name: r.name, category: r.category, points: r.points, costFils: r.costFils ?? null, stockMode: r.stockMode, stock: r.stock ?? null, status: r.status,
  buyPerRedemption: Boolean(r.buyPerRedemption),
});

export async function createReward(v: DgoViewer, input: RewardInput) {
  if (!can(v, "dgoRewards", "create")) throw httpError("You can't add rewards", 403);
  const clean = await cleanReward(v, input);
  const doc = await DgoReward.create({ organization: v.orgId, ...clean, createdBy: v.userId, createdByName: v.name, updatedBy: v.userId });
  const r = doc.toObject() as unknown as RewardDoc;
  await dgoAudit(v, "reward_created", "reward", r._id, null, auditShape(r));
  const settings = await settingsOn(v.orgId, dayIn(v.tz));
  return rewardDto(r, { manager: true, available: await spendable(v), pointValueAed: settings.pointValueAed });
}

export async function updateReward(v: DgoViewer, id: string, input: RewardInput) {
  if (!can(v, "dgoRewards", "edit")) throw httpError("You can't change rewards", 403);
  const before = await DgoReward.findOne({ _id: id, organization: v.orgId, status: { $ne: "archived" } }).lean<RewardDoc>();
  if (!before) throw httpError("That reward isn't in the catalogue", 404);
  const clean = await cleanReward(v, input, before);
  // Stock is set as typed; a redemption in the same instant may take one more — the conditional decrement keeps it at zero or above.
  const after = await DgoReward.findOneAndUpdate({ _id: id }, { $set: { ...clean, updatedBy: v.userId } }, { new: true }).lean<RewardDoc>();
  await dgoAudit(v, "reward_changed", "reward", before._id, auditShape(before), auditShape(after));
  const settings = await settingsOn(v.orgId, dayIn(v.tz));
  return rewardDto(after!, { manager: true, available: await spendable(v), pointValueAed: settings.pointValueAed });
}

/** Archive: gone from the store and the catalogue; redemptions keep what they were asked for at. */
export async function archiveReward(v: DgoViewer, id: string) {
  if (!can(v, "dgoRewards", "delete")) throw httpError("You can't remove rewards", 403);
  const before = await DgoReward.findOne({ _id: id, organization: v.orgId }).lean<RewardDoc>();
  if (!before) throw httpError("That reward isn't in the catalogue", 404);
  if (before.status === "archived") return { id };
  await DgoReward.updateOne({ _id: id }, { $set: { status: "archived", updatedBy: v.userId } });
  await dgoAudit(v, "reward_archived", "reward", before._id, auditShape(before), { status: "archived" });
  return { id };
}

/* ───────────── redemptions ───────────── */

type RedemptionStatus = "reserving" | "reserved" | "approved" | "fulfilled" | "cancelled" | "rejected";

interface RedemptionDoc {
  _id: Types.ObjectId;
  organization: unknown;
  employee: Types.ObjectId;
  user: unknown;
  employeeName: string;
  departmentName: string | null;
  reward: Types.ObjectId;
  rewardName: string;
  rewardCategory: string;
  photoKey: string | null;
  points: number;
  costFils: number | null;
  tookStock: boolean;
  needsPurchase?: boolean;
  procurement?: Types.ObjectId | null;
  purchaseStatus?: "not_needed" | "waiting_finance" | "approved" | "rejected" | "cancelled";
  purchaseRef?: string | null;
  status: RedemptionStatus;
  lots: Holding[];
  note: string | null;
  fulfilmentNote: string | null;
  trail: Array<{ action: string; by: unknown; byName: string | null; note: string | null; at: Date }>;
  createdAt: Date;
  updatedAt: Date;
}

const isOwn = (v: DgoViewer, r: { employee: unknown; user?: unknown }) =>
  (v.employee && v.employee._id === String(r.employee)) || (r.user != null && String(r.user) === v.userId);

/** Why this person may not handle (approve, reject, deliver) this redemption, or null. */
function whyCannotHandle(v: DgoViewer, r: RedemptionDoc): string | null {
  if (!canFulfil(v)) return "Only HR handles rewards";
  if (isOwn(v, r)) return "This is your own redemption, so someone else handles it";
  return null;
}

function redemptionDto(v: DgoViewer, r: RedemptionDoc, pointValueAed: number) {
  const why = whyCannotHandle(v, r);
  const waitingFinance = r.status === "approved" && r.purchaseStatus === "waiting_finance";
  const own = isOwn(v, r);
  return {
    id: String(r._id),
    employee: { id: String(r.employee), name: r.employeeName, department: r.departmentName ?? null },
    reward: { id: String(r.reward), name: r.rewardName, category: r.rewardCategory ?? "", photoUrl: r.photoKey ? publicUrl(r.photoKey) : null },
    points: r.points,
    aed: toAed(pointsToFils(r.points, pointValueAed)),
    costAed: canSeeFulfilment(v) && r.costFils != null ? toAed(r.costFils) : null,
    status: r.status === "reserving" ? "reserved" : r.status,
    note: r.note ?? null,
    fulfilmentNote: r.fulfilmentNote ?? null,
    trail: r.trail.map((t) => ({ action: t.action, byName: t.byName ?? null, note: t.note ?? null, at: iso(t.at) })),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    canCancel: Boolean(own) && r.status === "reserved",
    canApprove: !why && r.status === "reserved",
    canReject: !why && (r.status === "reserved" || r.status === "approved"),
    canFulfil: !why && r.status === "approved" && !waitingFinance,
    whyNot: (r.status === "reserved" || r.status === "approved") && canSeeFulfilment(v)
      ? why ?? (waitingFinance ? "Finance hasn't approved the purchase yet" : null)
      : null,
    purchase: { status: r.purchaseStatus ?? "not_needed", ref: r.purchaseRef || null },
  };
}

const spendOf = (r: RedemptionDoc, today: string): Spend => ({
  organization: r.organization, employee: r.employee, redemption: r._id, points: r.points, rewardName: r.rewardName, today,
});

/** GET /dgo-points/redemptions?tab=mine|queue|done */
export async function redemptionsView(v: DgoViewer, tabIn?: string) {
  const staff = canSeeFulfilment(v);
  const tab = tabIn === "queue" || tabIn === "done" ? tabIn : "mine";
  if (tab !== "mine" && !staff) throw httpError("You can't see other people's redemptions", 403);
  if (tab === "mine") await assertCanUse(v);
  const mineFilter = v.employee ? { organization: v.orgId, employee: v.employee._id, status: { $ne: "reserving" } } : null;
  const queueFilter = { organization: v.orgId, status: { $in: ["reserved", "approved"] } };
  const doneFilter = { organization: v.orgId, status: { $in: ["fulfilled", "cancelled", "rejected"] } };
  const [mineCount, queueCount, doneCount, settings] = await Promise.all([
    mineFilter ? DgoRedemption.countDocuments(mineFilter) : 0,
    staff ? DgoRedemption.countDocuments(queueFilter) : 0,
    staff ? DgoRedemption.countDocuments(doneFilter) : 0,
    settingsOn(v.orgId, dayIn(v.tz)),
  ]);
  let rows: RedemptionDoc[] = [];
  if (tab === "mine") rows = mineFilter ? await DgoRedemption.find(mineFilter).sort({ createdAt: -1 }).limit(200).lean<RedemptionDoc[]>() : [];
  else if (tab === "queue") rows = await DgoRedemption.find(queueFilter).sort({ createdAt: 1 }).limit(500).lean<RedemptionDoc[]>();
  else rows = await DgoRedemption.find(doneFilter).sort({ updatedAt: -1 }).limit(200).lean<RedemptionDoc[]>();
  return {
    tab,
    counts: { mine: mineCount, queue: queueCount, done: doneCount },
    items: rows.map((r) => redemptionDto(v, r, settings.pointValueAed)),
  };
}

async function load(v: DgoViewer, id: string): Promise<RedemptionDoc> {
  if (!isObjectId(id)) throw httpError("Unknown redemption", 400);
  const r = await DgoRedemption.findOne({ _id: id, organization: v.orgId }).lean<RedemptionDoc>();
  if (!r || r.status === "reserving") throw httpError("That redemption no longer exists", 404);
  return r;
}

async function dtoOf(v: DgoViewer, id: Types.ObjectId) {
  const [r, settings] = await Promise.all([DgoRedemption.findById(id).lean<RedemptionDoc>(), settingsOn(v.orgId, dayIn(v.tz))]);
  return redemptionDto(v, r!, settings.pointValueAed);
}

/** Done this step already (a double click): find it in the trail. */
const didAlready = (v: DgoViewer, r: RedemptionDoc, action: string) => r.trail.some((t) => t.action === action && String(t.by) === v.userId);

/**
 * POST /dgo-points/redemptions — ask for a reward: hold its points now.
 * Repeat-safe on requestId; refuses (and changes nothing) when the wallet or
 * the stock doesn't cover it.
 */
export async function redeem(v: DgoViewer, input: { rewardId: string; note?: string | null; requestId: string }) {
  await assertCanUse(v);
  if (!v.employee) throw httpError("Your login has no employee record, so it has no points to spend", 403);
  const key = `REDEMPTION:${v.orgId}:${input.requestId}`;
  const existing = await DgoRedemption.findOne({ idempotencyKey: key }).lean<RedemptionDoc>();
  if (existing && existing.status !== "reserving") return { redemption: await dtoOf(v, existing._id), duplicate: true, message: "Already asked for" };
  if (existing) throw httpError("That request is still going through — refresh in a moment", 409);

  const emp = await Employee.findOne({ _id: v.employee._id, organization: v.orgId }).select("name user department status")
    .lean<{ _id: Types.ObjectId; name: string; user?: unknown; department?: unknown; status: string }>();
  if (!emp || !ACTIVE_EMPLOYEE_STATUSES.includes(emp.status)) throw httpError("Only current employees can spend points", 403);
  if (!isObjectId(input.rewardId)) throw httpError("Unknown reward", 400);
  const reward = await DgoReward.findOne({ _id: input.rewardId, organization: v.orgId }).lean<RewardDoc>();
  if (!reward || reward.status === "archived") throw httpError("That reward isn't in the store any more", 404);
  if (reward.status !== "active") throw httpError("That reward isn't available right now", 409);
  const today = dayIn(v.tz);
  const settings = await settingsOn(v.orgId, today);
  if (reward.points < settings.minRedemption) throw httpError(`Rewards start at ${settings.minRedemption.toLocaleString("en")} points`, 409);
  const dept = emp.department ? await Department.findById(emp.department).select("name").lean<{ name: string }>() : null;

  const id = new mongoose.Types.ObjectId();
  const actor = actorOf(v);
  const spend: Spend = { organization: v.orgId, employee: emp._id, redemption: id, points: reward.points, rewardName: reward.name, today };
  try {
    await inTransaction(async (session) => {
      // The unique key goes in first, so the same request arriving twice reserves once.
      await DgoRedemption.create([{
        _id: id, organization: v.orgId, employee: emp._id, user: emp.user ?? null, employeeName: emp.name, departmentName: dept?.name ?? null,
        reward: reward._id, rewardName: reward.name, rewardCategory: reward.category, photoKey: reward.photoKey ?? null,
        points: reward.points, costFils: reward.costFils ?? null, status: "reserving", note: input.note?.trim() || null,
        needsPurchase: Boolean(reward.buyPerRedemption), purchaseStatus: "not_needed",
        trail: [trailEntry("asked", actor, input.note?.trim() || null)], idempotencyKey: key,
      }], { session });
      let tookStock = false;
      if (reward.stockMode === "limited") {
        const s = await DgoReward.updateOne({ _id: reward._id, status: "active", stock: { $gte: 1 } }, { $inc: { stock: -1 } }, { session });
        if (s.modifiedCount !== 1) throw httpError(`${reward.name} is out of stock`, 409);
        tookStock = true;
      }
      let held: Holding[] | null;
      try {
        held = await reservePoints(spend, actor, session);
      } catch (e) {
        if (tookStock && !session) await DgoReward.updateOne({ _id: reward._id }, { $inc: { stock: 1 } });
        throw e;
      }
      if (!held) {
        if (tookStock && !session) await DgoReward.updateOne({ _id: reward._id }, { $inc: { stock: 1 } });
        const have = await spendable(v);
        throw httpError(`Not enough points: ${reward.name} is ${reward.points.toLocaleString("en")} and you have ${have.toLocaleString("en")} to spend`, 409);
      }
      await DgoRedemption.updateOne(
        { _id: id },
        { $set: { status: "reserved", lots: held, tookStock }, $push: { trail: trailEntry("reserved", { userId: null, name: null }, `${reward.points.toLocaleString("en")} points held`) } },
        { session }
      );
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
      const again = await DgoRedemption.findOne({ idempotencyKey: key }).lean<RedemptionDoc>();
      if (again && again.status !== "reserving") return { redemption: await dtoOf(v, again._id), duplicate: true, message: "Already asked for" };
      throw httpError("That request is still going through — refresh in a moment", 409);
    }
    // Without a transaction the half-made request is removed; with one it never existed.
    await DgoRedemption.deleteOne({ _id: id, status: "reserving" }).catch(() => undefined);
    throw e;
  }
  await dgoAudit(v, "redemption_reserved", "redemption", id, null, { reward: reward.name, points: reward.points });
  const hr = await usersWith(v.orgId, "dgoRewards", "approve").catch(() => []);
  await notify({
    users: hr.filter((u) => u !== v.userId), kind: "approval", organization: v.orgId, actor: v.userId,
    title: `Reward to approve: ${reward.name}`, body: `${emp.name} · ${reward.points.toLocaleString("en")} points`, href: "/dgo-points/rewards?tab=fulfilment",
  });
  return { redemption: await dtoOf(v, id), duplicate: false, message: `${reward.points.toLocaleString("en")} points held — HR will approve it` };
}

/** Give the points (and any stock) back, once, moving the redemption from `from` to `to`. */
async function giveBack(v: DgoViewer, r: RedemptionDoc, from: RedemptionStatus[], to: "cancelled" | "rejected", note: string | null) {
  return giveBackAs(actorOf(v), dayIn(v.tz), r, from, to, note);
}

/** giveBack without a signed-in person: finance's decision, the nightly job. */
export async function giveBackAs(
  actor: Actor, today: string, r: { _id: Types.ObjectId }, from: RedemptionStatus[], to: "cancelled" | "rejected", note: string | null,
  purchaseStatus?: "rejected" | "cancelled",
): Promise<boolean> {
  const moved = await inTransaction(async (session) => {
    const claimed = await DgoRedemption.findOneAndUpdate(
      { _id: r._id, status: { $in: from } },
      { $set: { status: to, ...(purchaseStatus ? { purchaseStatus } : {}) }, $push: { trail: trailEntry(to, actor, note) } },
      { new: true, session }
    ).lean<RedemptionDoc>();
    if (!claimed) return null;
    await releasePoints(spendOf(claimed, today), claimed.lots, to === "cancelled" ? "Cancelled" : "Not approved", actor, session);
    if (claimed.tookStock) await DgoReward.updateOne({ _id: claimed.reward, stockMode: "limited" }, { $inc: { stock: 1 } }, { session });
    return claimed;
  });
  if (!moved) return false;
  // A purchase request still waiting on finance is withdrawn; one finance already approved is left for finance to void.
  if (moved.procurement) await Procurement.updateOne({ _id: moved.procurement, status: "hr_approved" }, { $set: { status: "cancelled" } });
  if (moved.procurement && !purchaseStatus) {
    await DgoRedemption.updateOne({ _id: moved._id, purchaseStatus: "waiting_finance" }, { $set: { purchaseStatus: "cancelled" } });
  }
  return true;
}

/** POST /redemptions/:id/cancel — the employee, while it waits for HR. */
export async function cancelRedemption(v: DgoViewer, id: string) {
  const r = await load(v, id);
  if (!isOwn(v, r)) throw httpError("Only the person who asked can cancel it", 403);
  if (r.status === "cancelled") return { redemption: await dtoOf(v, r._id), message: "Already done" };
  if (r.status !== "reserved") throw httpError(r.status === "approved" ? "HR has approved it — ask HR to cancel it" : `Already ${r.status}`, 409);
  const moved = await giveBack(v, r, ["reserved"], "cancelled", null);
  if (!moved) {
    const now = await load(v, id);
    if (now.status === "cancelled") return { redemption: await dtoOf(v, r._id), message: "Already done" };
    throw httpError(`It was ${now.status} in the meantime`, 409);
  }
  await dgoAudit(v, "redemption_cancelled", "redemption", r._id, { status: "reserved" }, { status: "cancelled" });
  return { redemption: await dtoOf(v, r._id), message: `Cancelled — ${r.points.toLocaleString("en")} points are back` };
}

async function assertHandle(v: DgoViewer, r: RedemptionDoc, action: string) {
  const why = whyCannotHandle(v, r);
  if (!why) return;
  if (isOwn(v, r) && canFulfil(v)) await dgoAudit(v, "redemption_refused", "redemption", r._id, null, { reason: "own redemption", action });
  throw httpError(why, 403);
}

/** POST /redemptions/:id/approve — HR. Nothing moves; the points stay held until delivery. */
export async function approveRedemption(v: DgoViewer, id: string, note?: string | null) {
  const r = await load(v, id);
  if (didAlready(v, r, "approved") && r.status !== "reserved") return { redemption: await dtoOf(v, r._id), message: "Already done" };
  await assertHandle(v, r, "approve");
  if (r.status !== "reserved") throw httpError(`Already ${r.status}`, 409);
  // Bought per redemption: the purchase request goes in first (one per redemption), straight to finance.
  const procurementId = r.needsPurchase ? await raisePurchase(v, r) : null;
  const after = await DgoRedemption.findOneAndUpdate(
    { _id: r._id, status: "reserved" },
    {
      $set: { status: "approved", ...(procurementId ? { procurement: procurementId, purchaseStatus: "waiting_finance" } : {}) },
      $push: { trail: trailEntry("approved", actorOf(v), note?.trim() || (procurementId ? "Purchase request sent to finance" : null)) },
    },
    { new: true }
  ).lean<RedemptionDoc>();
  if (!after) {
    if (procurementId) await Procurement.updateOne({ _id: procurementId, status: "hr_approved" }, { $set: { status: "cancelled" } });
    throw httpError("It changed in the meantime — refresh", 409);
  }
  await dgoAudit(v, "redemption_approved", "redemption", r._id, { status: "reserved" }, { status: "approved" });
  await notify({ users: [r.user], kind: "system", tone: "positive", organization: v.orgId, actor: v.userId, title: `Approved: ${r.rewardName}`, body: "HR will let you know when it's ready", href: "/dgo-points/rewards?tab=mine" });
  return { redemption: await dtoOf(v, r._id), message: procurementId ? "Approved — the purchase request is with finance" : "Approved" };
}

/** The HRMS purchase request for one redemption's reward, already past HR (HR approved the redemption). Once per redemption. */
async function raisePurchase(v: DgoViewer, r: RedemptionDoc): Promise<Types.ObjectId> {
  const found = await Procurement.findOne({ dgoRedemption: r._id }).select("_id status").lean<{ _id: Types.ObjectId; status: string }>();
  if (found && found.status !== "cancelled") return found._id;
  const emp = await Employee.findById(r.employee).select("department").lean<{ department?: unknown }>();
  try {
    const doc = await Procurement.create({
      organization: v.orgId, kind: "new", item: `DGO reward: ${r.rewardName} for ${r.employeeName}`.slice(0, 160),
      category: "DGO reward", quantity: 1, estimatedCost: r.costFils != null ? toAed(r.costFils) : 0, currency: "AED", vendor: "",
      department: emp?.department ?? null, requestedBy: v.userId,
      justification: `DGO Points redemption: ${r.points.toLocaleString("en")} points spent by ${r.employeeName}. Approved by ${v.name} in DGO Points.`.slice(0, 1000),
      status: "hr_approved", hrReviewedBy: v.userId, hrReviewedAt: new Date(), hrNote: "Approved as a DGO Points redemption",
      dgoRedemption: r._id,
    });
    return doc._id as Types.ObjectId;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    // A cancelled one from an earlier round, or another click at the same moment.
    const again = await Procurement.findOne({ dgoRedemption: r._id }).select("_id status").lean<{ _id: Types.ObjectId; status: string }>();
    if (again?.status === "cancelled") {
      await Procurement.updateOne({ _id: again._id }, { $set: { status: "hr_approved", hrReviewedBy: v.userId, hrReviewedAt: new Date() } });
    }
    return again!._id;
  }
}

/**
 * Finance decided on a redemption's purchase request (called from the
 * procurement service when finance's decision lands). Approved: HR may buy
 * and hand it over. Rejected: the redemption is rejected and the points go back.
 */
export async function onPurchaseDecision(p: { _id: unknown; organization?: unknown; dgoRedemption?: unknown }, approved: boolean, note: string | null, ref: string | null) {
  if (!p.dgoRedemption) return;
  const r = await DgoRedemption.findById(p.dgoRedemption).lean<RedemptionDoc>();
  if (!r) return;
  const actor: Actor = { userId: null, name: "Finance" };
  const orgId = String(r.organization);
  if (approved) {
    const done = await DgoRedemption.updateOne(
      { _id: r._id, purchaseStatus: "waiting_finance" },
      { $set: { purchaseStatus: "approved", purchaseRef: ref || null }, $push: { trail: trailEntry("purchase_approved", actor, ref ? `Expense ${ref}` : note) } }
    );
    if (!done.modifiedCount) return;
    const hr = await usersWith(orgId, "dgoRewards", "approve").catch(() => []);
    await notify({ users: hr, kind: "system", tone: "positive", organization: orgId, title: `Ready to buy: ${r.rewardName}`, body: `For ${r.employeeName}${ref ? ` · ${ref}` : ""}`, href: "/dgo-points/rewards?tab=fulfilment" });
    return;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const moved = await giveBackAs(actor, today, r, ["reserved", "approved"], "rejected", `Finance didn't approve the purchase${note ? `: ${note}` : ""}`, "rejected");
  if (!moved) return;
  await notify({ users: [r.user], kind: "system", tone: "negative", organization: orgId, title: `Not approved: ${r.rewardName}`, body: `Finance didn't approve the purchase — your ${r.points.toLocaleString("en")} points are back`, href: "/dgo-points/rewards?tab=mine" });
}

/** POST /redemptions/:id/reject — HR, before delivery: the points come back once. */
export async function rejectRedemption(v: DgoViewer, id: string, reason: string) {
  const r = await load(v, id);
  if (r.status === "rejected" && didAlready(v, r, "rejected")) return { redemption: await dtoOf(v, r._id), message: "Already done" };
  await assertHandle(v, r, "reject");
  if (!reason?.trim()) throw httpError("Say why it isn't approved", 400);
  if (r.status !== "reserved" && r.status !== "approved") throw httpError(`Already ${r.status}`, 409);
  const moved = await giveBack(v, r, ["reserved", "approved"], "rejected", reason.trim());
  if (!moved) throw httpError("It changed in the meantime — refresh", 409);
  const expenseLeft = r.purchaseStatus === "approved";
  await dgoAudit(v, "redemption_rejected", "redemption", r._id, { status: r.status }, { status: "rejected", reason: reason.trim() });
  await notify({ users: [r.user], kind: "system", tone: "negative", organization: v.orgId, actor: v.userId, title: `Not approved: ${r.rewardName}`, body: `${reason.trim()} — your ${r.points.toLocaleString("en")} points are back`, href: "/dgo-points/rewards?tab=mine" });
  return {
    redemption: await dtoOf(v, r._id),
    message: `Rejected — ${r.points.toLocaleString("en")} points went back to ${r.employeeName}${expenseLeft ? `. Finance already approved its purchase${r.purchaseRef ? ` (${r.purchaseRef})` : ""}: ask finance to void that expense` : ""}`,
  };
}

/** POST /redemptions/:id/fulfil — HR, after approval: handed over, the held points are spent. */
export async function fulfilRedemption(v: DgoViewer, id: string, note?: string | null) {
  const r = await load(v, id);
  if (r.status === "fulfilled" && didAlready(v, r, "fulfilled")) return { redemption: await dtoOf(v, r._id), message: "Already done" };
  await assertHandle(v, r, "fulfil");
  if (r.status !== "approved") throw httpError(r.status === "reserved" ? "Approve it first" : `Already ${r.status}`, 409);
  if (r.purchaseStatus === "waiting_finance") throw httpError("Finance hasn't approved the purchase yet", 409);
  const today = dayIn(v.tz);
  const actor = actorOf(v);
  const done = await inTransaction(async (session) => {
    const claimed = await DgoRedemption.findOneAndUpdate(
      { _id: r._id, status: "approved" },
      { $set: { status: "fulfilled", fulfilledAt: new Date(), fulfilmentNote: note?.trim() || null }, $push: { trail: trailEntry("fulfilled", actor, note?.trim() || null) } },
      { new: true, session }
    ).lean<RedemptionDoc>();
    if (!claimed) return false;
    await redeemPoints(spendOf(claimed, today), claimed.lots, actor, session);
    return true;
  });
  if (!done) throw httpError("It changed in the meantime — refresh", 409);
  if (r.procurement) {
    // Bought and handed over: the purchase request is done (and, being a reward, never counts as stock).
    await Procurement.updateOne({ _id: r.procurement, status: { $in: ["approved", "ordered"] } }, { $set: { status: "received", receivedAt: new Date(), receivedQuantity: 1, receivedBy: v.userId } });
  }
  await dgoAudit(v, "redemption_fulfilled", "redemption", r._id, { status: "approved" }, { status: "fulfilled", note: note?.trim() || null });
  await notify({ users: [r.user], kind: "system", tone: "positive", organization: v.orgId, actor: v.userId, title: `Ready: ${r.rewardName}`, body: note?.trim() || "Your reward has been handed over", href: "/dgo-points/rewards?tab=mine" });
  return { redemption: await dtoOf(v, r._id), message: "Marked delivered" };
}
