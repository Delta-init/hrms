import mongoose, { type ClientSession, type Types } from "mongoose";
import { DgoLedgerEntry } from "../../models/DgoLedgerEntry.js";
import { DgoPointLot } from "../../models/DgoPointLot.js";
import { DgoWallet } from "../../models/DgoWallet.js";
import { addMonthsToDay } from "./dgoMath.js";
import { httpError } from "./dgoErrors.js";

/**
 * Moving points. Every move is a ledger row with a unique key derived from what
 * caused it (`CREDIT:<event>`, `REVERSE:<event>`), so a retry, a double click or
 * a replayed source finds the row already there and changes nothing. The wallet
 * is a cached sum, updated in the same step and always rebuildable.
 */

export interface PostableEvent {
  _id: Types.ObjectId;
  organization: unknown;
  employee: unknown;
  points: number;
  day: string;
  month: string;
  ruleCode: string;
  ruleName: string;
  lot?: unknown;
}

export interface Actor { userId: string | null; name: string | null }

export class AlreadyCredited extends Error {
  constructor() { super("Already credited"); }
}

/** Credit an event's points as a new lot expiring `expiryMonths` after the event's day. */
export async function creditEvent(ev: PostableEvent, expiryMonths: number, actor: Actor, session?: ClientSession): Promise<Types.ObjectId> {
  const key = `CREDIT:${ev._id}`;
  if (await DgoLedgerEntry.exists({ idempotencyKey: key }).session(session ?? null)) throw new AlreadyCredited();
  const lotId = new mongoose.Types.ObjectId();
  const description = ev.ruleName;
  await DgoLedgerEntry.create([{
    organization: ev.organization, employee: ev.employee, delta: ev.points, type: "credit", lot: lotId, earningEvent: ev._id,
    ruleCode: ev.ruleCode, day: ev.day, month: ev.month, description, idempotencyKey: key,
    createdBy: actor.userId, createdByName: actor.name,
  }], { session });
  await DgoPointLot.create([{
    _id: lotId, organization: ev.organization, employee: ev.employee, issued: ev.points, remaining: ev.points, reserved: 0,
    issuedOn: ev.day, expiresOn: addMonthsToDay(ev.day, expiryMonths), earningEvent: ev._id, ruleCode: ev.ruleCode, description,
  }], { session });
  await DgoWallet.updateOne(
    { employee: ev.employee },
    { $inc: { available: ev.points, lifetimeEarned: ev.points }, $setOnInsert: { organization: ev.organization } },
    { upsert: true, session }
  );
  return lotId;
}

/**
 * Take a credited event's points back with a reversal row. Refused when any of
 * its lot has been spent or reserved: those points are no longer there to take.
 */
export async function reverseEvent(ev: PostableEvent, today: string, why: string, actor: Actor, session?: ClientSession): Promise<void> {
  const key = `REVERSE:${ev._id}`;
  if (await DgoLedgerEntry.exists({ idempotencyKey: key }).session(session ?? null)) return;
  const credit = await DgoLedgerEntry.findOne({ idempotencyKey: `CREDIT:${ev._id}` }).session(session ?? null).lean<{ _id: Types.ObjectId; lot: Types.ObjectId }>();
  if (!credit) throw httpError("Those points were never credited", 409);
  const lot = await DgoPointLot.findOneAndUpdate(
    { _id: credit.lot, remaining: ev.points, reserved: 0 },
    { $set: { remaining: 0 } },
    { new: true, session }
  );
  if (!lot) throw httpError("Some of these points are already spent or reserved, so they can't be taken back", 409);
  await DgoLedgerEntry.create([{
    organization: ev.organization, employee: ev.employee, delta: -ev.points, type: "reverse", lot: credit.lot, earningEvent: ev._id,
    ruleCode: ev.ruleCode, day: today, month: today.slice(0, 7), description: `${why}: ${ev.ruleName} (${ev.day})`,
    reversalOf: credit._id, idempotencyKey: key, createdBy: actor.userId, createdByName: actor.name,
  }], { session });
  await DgoWallet.updateOne({ employee: ev.employee }, { $inc: { available: -ev.points, reversed: ev.points } }, { session });
}

/** What the ledger says a wallet holds. Spendable is the sum of `delta`; held is the sum of `reservedDelta`. */
export async function ledgerBalances(employee: unknown) {
  const rows = await DgoLedgerEntry.aggregate<{ _id: string; sum: number; held: number }>([
    { $match: { employee: new mongoose.Types.ObjectId(String(employee)) } },
    { $group: { _id: "$type", sum: { $sum: "$delta" }, held: { $sum: { $ifNull: ["$reservedDelta", 0] } } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r])) as Record<string, { sum: number; held: number }>;
  return {
    available: rows.reduce((s, r) => s + r.sum, 0),
    reserved: rows.reduce((s, r) => s + r.held, 0),
    lifetimeEarned: by.credit?.sum ?? 0,
    redeemed: -(by.redeem?.held ?? 0),
    reversed: -(by.reverse?.sum ?? 0),
    expired: -(by.expire?.sum ?? 0),
  };
}

type Balances = Awaited<ReturnType<typeof ledgerBalances>>;
const BALANCE_KEYS: Array<keyof Balances> = ["available", "reserved", "lifetimeEarned", "redeemed", "reversed", "expired"];

/** Recompute a wallet from the ledger; returns whether the cached one had drifted. */
export async function rebuildWallet(organization: unknown, employee: unknown): Promise<{ drifted: boolean }> {
  const truth = await ledgerBalances(employee);
  const cached = await DgoWallet.findOne({ employee }).lean<Partial<Balances>>();
  const drifted = !cached || BALANCE_KEYS.some((k) => (cached[k] ?? 0) !== truth[k]);
  if (drifted) {
    await DgoWallet.updateOne({ employee }, { $set: truth, $setOnInsert: { organization } }, { upsert: true });
  }
  return { drifted: drifted && Boolean(cached) };
}

/* ───────────── Spending: reserve, release, redeem (Phase 2) ───────────── */

export interface Holding { lot: Types.ObjectId; points: number }

export interface Spend {
  organization: unknown;
  employee: unknown;
  redemption: Types.ObjectId;
  points: number;
  rewardName: string;
  today: string;
}

/**
 * Hold `points` of an employee's spendable points for a redemption: the wallet
 * first, by one conditional update that cannot take it below zero (so two
 * requests at the same moment cannot both spend the same points), then the
 * batches that expire first, each by its own conditional update. Returns the
 * batches held, or null when the wallet doesn't cover it. Any failure after the
 * wallet moved puts everything back before throwing.
 */
export async function reservePoints(s: Spend, actor: Actor, session?: ClientSession): Promise<Holding[] | null> {
  const w = await DgoWallet.updateOne(
    { employee: s.employee, available: { $gte: s.points } },
    { $inc: { available: -s.points, reserved: s.points } },
    { session }
  );
  if (w.modifiedCount !== 1) return null;
  const held: Holding[] = [];
  const undo = async () => {
    if (session) return; // the transaction rolls everything back
    for (const h of held) await DgoPointLot.updateOne({ _id: h.lot, reserved: { $gte: h.points } }, { $inc: { reserved: -h.points } });
    await DgoWallet.updateOne({ employee: s.employee }, { $inc: { available: s.points, reserved: -s.points } });
  };
  try {
    let need = s.points;
    for (let pass = 0; need > 0 && pass < 5; pass++) {
      const lots = await DgoPointLot.find({ employee: s.employee, expiresOn: { $gte: s.today }, $expr: { $gt: ["$remaining", "$reserved"] } })
        .sort({ expiresOn: 1, _id: 1 }).session(session ?? null).lean<Array<{ _id: Types.ObjectId; remaining: number; reserved: number }>>();
      if (!lots.length) break;
      for (const lot of lots) {
        if (need <= 0) break;
        const take = Math.min(need, lot.remaining - lot.reserved);
        if (take <= 0) continue;
        const r = await DgoPointLot.updateOne(
          { _id: lot._id, $expr: { $gte: [{ $subtract: ["$remaining", "$reserved"] }, take] } },
          { $inc: { reserved: take } },
          { session }
        );
        if (r.modifiedCount !== 1) continue; // somebody else took part of it; the next pass re-reads
        const same = held.find((h) => String(h.lot) === String(lot._id));
        if (same) same.points += take; else held.push({ lot: lot._id, points: take });
        need -= take;
      }
    }
    if (need > 0) {
      // The cached wallet said yes but the batches don't hold enough: it has drifted from the ledger.
      throw httpError("Your points don't add up right now, so nothing was taken. Finance can recount your wallet.", 409);
    }
    await DgoLedgerEntry.create([{
      organization: s.organization, employee: s.employee, delta: -s.points, reservedDelta: s.points, type: "reserve",
      redemption: s.redemption, day: s.today, month: s.today.slice(0, 7), description: `Held for ${s.rewardName}`,
      idempotencyKey: `RESERVE:${s.redemption}`, createdBy: actor.userId, createdByName: actor.name,
    }], { session });
    return held;
  } catch (e) {
    await undo();
    throw e;
  }
}

/**
 * Give held points back (a cancel or a rejection). Exactly once: the ledger row
 * keyed on the redemption goes in first, and a second attempt finds it and
 * changes nothing.
 */
export async function releasePoints(s: Spend, held: Holding[], why: string, actor: Actor, session?: ClientSession): Promise<boolean> {
  try {
    await DgoLedgerEntry.create([{
      organization: s.organization, employee: s.employee, delta: s.points, reservedDelta: -s.points, type: "release",
      redemption: s.redemption, day: s.today, month: s.today.slice(0, 7), description: `${why}: ${s.rewardName}`,
      idempotencyKey: `RELEASE:${s.redemption}`, createdBy: actor.userId, createdByName: actor.name,
    }], { session });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
  for (const h of held) await DgoPointLot.updateOne({ _id: h.lot, reserved: { $gte: h.points } }, { $inc: { reserved: -h.points } }, { session });
  await DgoWallet.updateOne({ employee: s.employee }, { $inc: { available: s.points, reserved: -s.points } }, { session });
  return true;
}

/** Spend held points (the reward was handed over). Exactly once, as releasePoints. */
export async function redeemPoints(s: Spend, held: Holding[], actor: Actor, session?: ClientSession): Promise<boolean> {
  try {
    await DgoLedgerEntry.create([{
      organization: s.organization, employee: s.employee, delta: 0, reservedDelta: -s.points, type: "redeem",
      redemption: s.redemption, day: s.today, month: s.today.slice(0, 7), description: `Spent on ${s.rewardName}`,
      idempotencyKey: `REDEEM:${s.redemption}`, createdBy: actor.userId, createdByName: actor.name,
    }], { session });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
  for (const h of held) {
    await DgoPointLot.updateOne(
      { _id: h.lot, reserved: { $gte: h.points }, remaining: { $gte: h.points } },
      { $inc: { reserved: -h.points, remaining: -h.points } },
      { session }
    );
  }
  await DgoWallet.updateOne({ employee: s.employee }, { $inc: { reserved: -s.points, redeemed: s.points } }, { session });
  return true;
}

/* ───────────── Adjustments and expiry (Phase 3) ───────────── */

export interface Movement {
  organization: unknown;
  employee: unknown;
  points: number;          // positive
  key: string;             // the ledger row's unique key
  description: string;
  today: string;
  expiryMonths?: number;   // for added points
}

/** Add points outside any rule (an approved adjustment): a new batch expiring like any credit. Once per key. */
export async function addPoints(m: Movement, actor: Actor, session?: ClientSession): Promise<boolean> {
  if (await DgoLedgerEntry.exists({ idempotencyKey: m.key }).session(session ?? null)) return false;
  const lotId = new mongoose.Types.ObjectId();
  await DgoLedgerEntry.create([{
    organization: m.organization, employee: m.employee, delta: m.points, type: "adjust", lot: lotId,
    day: m.today, month: m.today.slice(0, 7), description: m.description, idempotencyKey: m.key,
    createdBy: actor.userId, createdByName: actor.name,
  }], { session });
  await DgoPointLot.create([{
    _id: lotId, organization: m.organization, employee: m.employee, issued: m.points, remaining: m.points, reserved: 0,
    issuedOn: m.today, expiresOn: addMonthsToDay(m.today, m.expiryMonths ?? 12), ruleCode: "ADJUSTMENT", description: m.description,
  }], { session });
  await DgoWallet.updateOne({ employee: m.employee }, { $inc: { available: m.points }, $setOnInsert: { organization: m.organization } }, { upsert: true, session });
  return true;
}

/**
 * Take spendable points away (an approved adjustment): the wallet first, by a
 * conditional update that can't take it below zero, then the batches that
 * expire first. Held points are never touched. Null when there aren't enough.
 */
export async function removePoints(m: Movement, actor: Actor, session?: ClientSession): Promise<boolean | null> {
  if (await DgoLedgerEntry.exists({ idempotencyKey: m.key }).session(session ?? null)) return false;
  const w = await DgoWallet.updateOne({ employee: m.employee, available: { $gte: m.points } }, { $inc: { available: -m.points } }, { session });
  if (w.modifiedCount !== 1) return null;
  const taken: Holding[] = [];
  try {
    let need = m.points;
    for (let pass = 0; need > 0 && pass < 5; pass++) {
      const lots = await DgoPointLot.find({ employee: m.employee, $expr: { $gt: ["$remaining", "$reserved"] } })
        .sort({ expiresOn: 1, _id: 1 }).session(session ?? null).lean<Array<{ _id: Types.ObjectId; remaining: number; reserved: number }>>();
      if (!lots.length) break;
      for (const lot of lots) {
        if (need <= 0) break;
        const take = Math.min(need, lot.remaining - lot.reserved);
        if (take <= 0) continue;
        const r = await DgoPointLot.updateOne(
          { _id: lot._id, $expr: { $gte: [{ $subtract: ["$remaining", "$reserved"] }, take] } },
          { $inc: { remaining: -take } },
          { session }
        );
        if (r.modifiedCount !== 1) continue;
        taken.push({ lot: lot._id, points: take });
        need -= take;
      }
    }
    if (need > 0) throw httpError("Their points don't add up right now, so nothing was taken. Recount the wallet first.", 409);
    await DgoLedgerEntry.create([{
      organization: m.organization, employee: m.employee, delta: -m.points, type: "adjust",
      day: m.today, month: m.today.slice(0, 7), description: m.description, idempotencyKey: m.key,
      createdBy: actor.userId, createdByName: actor.name,
    }], { session });
    return true;
  } catch (e) {
    if (!session) {
      for (const h of taken) await DgoPointLot.updateOne({ _id: h.lot }, { $inc: { remaining: h.points } });
      await DgoWallet.updateOne({ employee: m.employee }, { $inc: { available: m.points } });
    }
    throw e;
  }
}

/**
 * Expire what is spendable in one batch: everything but the part held for a
 * redemption in progress, which is kept until that redemption ends (if it is
 * cancelled, the points come back to the batch and expire on the next run).
 * The batch moves first, conditionally on what was read, so two runs can't
 * expire the same points; the ledger row's key carries what was there.
 */
export async function expireLot(
  lot: { _id: Types.ObjectId; organization: unknown; employee: unknown; remaining: number; reserved: number; description?: string },
  today: string, why: string, actor: Actor, session?: ClientSession,
): Promise<number> {
  const x = lot.remaining - lot.reserved;
  if (x <= 0) return 0;
  const moved = await DgoPointLot.updateOne(
    { _id: lot._id, remaining: lot.remaining, reserved: lot.reserved },
    { $set: { remaining: lot.reserved } },
    { session }
  );
  if (moved.modifiedCount !== 1) return 0;
  await DgoLedgerEntry.create([{
    organization: lot.organization, employee: lot.employee, delta: -x, type: "expire", lot: lot._id,
    day: today, month: today.slice(0, 7), description: `${why}${lot.description ? `: ${lot.description}` : ""}`.slice(0, 300),
    idempotencyKey: `EXPIRE:${lot._id}:${lot.remaining}`, createdBy: actor.userId, createdByName: actor.name,
  }], { session });
  await DgoWallet.updateOne({ employee: lot.employee }, { $inc: { available: -x, expired: x } }, { session });
  return x;
}

