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

/** What the ledger says a wallet holds. */
export async function ledgerBalances(employee: unknown) {
  const rows = await DgoLedgerEntry.aggregate<{ _id: string; sum: number }>([
    { $match: { employee: new mongoose.Types.ObjectId(String(employee)) } },
    { $group: { _id: "$type", sum: { $sum: "$delta" } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.sum])) as Record<string, number>;
  return {
    available: rows.reduce((s, r) => s + r.sum, 0),
    lifetimeEarned: by.credit ?? 0,
    reversed: -(by.reverse ?? 0),
    expired: -(by.expire ?? 0),
  };
}

/** Recompute a wallet from the ledger; returns whether the cached one had drifted. */
export async function rebuildWallet(organization: unknown, employee: unknown): Promise<{ drifted: boolean }> {
  const truth = await ledgerBalances(employee);
  const cached = await DgoWallet.findOne({ employee }).lean<{ available: number; lifetimeEarned: number; reversed: number; expired: number }>();
  const drifted = !cached || cached.available !== truth.available || cached.lifetimeEarned !== truth.lifetimeEarned
    || cached.reversed !== truth.reversed || cached.expired !== truth.expired;
  if (drifted) {
    await DgoWallet.updateOne({ employee }, { $set: truth, $setOnInsert: { organization } }, { upsert: true });
  }
  return { drifted: drifted && Boolean(cached) };
}
