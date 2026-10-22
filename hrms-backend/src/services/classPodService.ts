import { Types } from "mongoose";
import { MeetingBooking } from "../models/MeetingBooking.js";
import { MeetingRoom } from "../models/MeetingRoom.js";
import { User } from "../models/User.js";
import { getOrgId, scoped } from "../utils/orgContext.js";
import { heldBefore } from "../utils/roomClaim.js";
import { announceBooking } from "./bookingAlertService.js";

/*
 * Pods for the LMS's online classes (the user, 2026-10-18: "every online class gets a meeting room from the HRMS —
 * pods 4 and 6–11 only — never overlapping").
 *
 * The LMS names the pods it may use and asks, for each class, for one of them over the class's time. Each class has
 * at most one booking here (`source: { system: "lms", ref: <class id> }`): kept while its room and time still hold,
 * moved when they change, cancelled when the class goes. A pod is never handed to two at once — the clash test before
 * writing, and the older-wins check after (utils/roomClaim.ts). These bookings send no reminders: the LMS reminds its
 * mentors.
 */

const LMS = "lms";
const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export interface PodRoom { id: string; name: string; capacity: number; location: string }
export interface PodBooking {
  id: string; roomId: string; roomName: string; start: string; end: string; title: string;
  /** Who has it: the organiser's name, or the label another system gave it. */
  holder: string;
  /** The LMS class it is for, when the LMS made it. */
  classRef: string | null;
}

/** The pods by name, in the order asked — active rooms of this organization; names it has no such room for are left out. */
export async function podsNamed(names: string[]): Promise<PodRoom[]> {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return [];
  const rooms = await MeetingRoom.find(scoped({ active: true })).select("name capacity location").lean();
  const byName = new Map(rooms.map((r) => [String(r.name).trim().toLowerCase(), r]));
  return wanted.flatMap((n) => {
    const r = byName.get(n);
    return r ? [{ id: String(r._id), name: String(r.name), capacity: Number(r.capacity ?? 0), location: String(r.location ?? "") }] : [];
  });
}

/** Every booking in these rooms overlapping [from, to), whoever made it. */
export async function podBookings(roomIds: string[], from: Date, to: Date): Promise<PodBooking[]> {
  const ids = roomIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (!ids.length) return [];
  const rows = await MeetingBooking.find(scoped({ room: { $in: ids }, status: "booked", start: { $lt: to }, end: { $gt: from } }))
    .populate("room", "name").populate("organizer", "name").sort({ start: 1 }).lean();
  return rows.map((b) => {
    const r = b as unknown as { _id: unknown; room?: { _id: unknown; name?: string } | null; organizer?: { name?: string } | null; source?: { system?: string; ref?: string; label?: string } | null; kind?: string };
    return {
      id: String(r._id), roomId: String(r.room?._id ?? ""), roomName: String(r.room?.name ?? ""),
      start: b.start.toISOString(), end: b.end.toISOString(),
      // A review is about one person: its title is not for another system's screens.
      title: r.kind === "review" ? "Review meeting" : b.title,
      holder: r.source?.label || r.organizer?.name || "",
      classRef: r.source?.system === LMS ? String(r.source.ref) : null,
    };
  });
}

export interface HoldInput {
  ref: string;
  /** The pods it may have, the one to try first first. */
  roomIds: string[];
  start: Date;
  end: Date;
  title: string;
  /** Who has it, as the screens show it: "LMS class · <mentor>". */
  label: string;
  /** The mentor's email: their login here, when they have one, is the organiser. */
  organizerEmail?: string;
}

export type HoldResult =
  | { ok: true; booking: PodBooking; changed: boolean }
  | { ok: false; reason: "no_room"; message: string };

const theOne = (ref: string) => MeetingBooking.findOne(scoped({ "source.system": LMS, "source.ref": ref, status: "booked" }));

/**
 * A pod for one class over [start, end): the one it has if that still holds, else the first free one of `roomIds`.
 * No pod free: whatever it had is let go (it is at the wrong time now) and it says so.
 */
export async function holdForClass(input: HoldInput): Promise<HoldResult> {
  if (!input.ref) throw bad("ref is required");
  if (!(input.end > input.start)) throw bad("end must be after start");
  const allowed = await MeetingRoom.find(scoped({ _id: { $in: input.roomIds.filter((id) => Types.ObjectId.isValid(id)) }, active: true })).select("name").lean();
  const nameOf = new Map(allowed.map((r) => [String(r._id), String(r.name)]));
  const order = input.roomIds.filter((id) => nameOf.has(id));
  if (!order.length) throw bad("None of those rooms is an active room of this organization");

  const have = await theOne(input.ref);
  const title = input.title.slice(0, 140);
  const label = input.label.slice(0, 120);
  // Still right where it is: the words brought up to date, nothing moved.
  if (have && order.includes(String(have.room)) && have.start.getTime() === input.start.getTime() && have.end.getTime() === input.end.getTime()) {
    if (have.title !== title || have.source?.label !== label) {
      await MeetingBooking.updateOne({ _id: have._id }, { $set: { title, "source.label": label } });
    }
    return { ok: true, booking: await asPod(have._id), changed: false };
  }

  const organizer = input.organizerEmail
    ? await User.findOne({ email: input.organizerEmail.trim().toLowerCase(), status: { $ne: "inactive" } }).select("_id").lean()
    : null;
  // The pod it has first, so a class that only moved a little keeps its room when it can.
  const tryOrder = have && order.includes(String(have.room)) ? [String(have.room), ...order.filter((id) => id !== String(have.room))] : order;
  for (const roomId of tryOrder) {
    const clash = await MeetingBooking.findOne(scoped({
      room: roomId, status: "booked", start: { $lt: input.end }, end: { $gt: input.start },
      ...(have ? { _id: { $ne: have._id } } : {}),
    })).select("_id").lean();
    if (clash) continue;
    const made = await MeetingBooking.create({
      organization: getOrgId(), room: new Types.ObjectId(roomId), title, start: input.start, end: input.end,
      timeZone: "Asia/Dubai", organizer: organizer?._id ?? null, participants: [], status: "booked", kind: "meeting", mode: "room",
      agenda: "Booked by the LMS for a class.", source: { system: LMS, ref: input.ref, label },
    });
    // Somebody took it at the same moment and was first: this one goes, and the next pod is tried.
    if (await heldBefore(made._id, made.room, made.start, made.end, have ? [have._id] : [])) {
      await MeetingBooking.deleteOne({ _id: made._id });
      continue;
    }
    // The same class asked twice at once, and the other was made first: that one is its pod, this one goes.
    const twin = await MeetingBooking.findOne(scoped({
      "source.system": LMS, "source.ref": input.ref, status: "booked",
      _id: { $lt: made._id, ...(have ? { $ne: have._id } : {}) },
    })).select("_id").lean();
    if (twin) {
      await MeetingBooking.deleteOne({ _id: made._id });
      return { ok: true, booking: await asPod(twin._id), changed: true };
    }
    if (have) await MeetingBooking.updateOne({ _id: have._id }, { $set: { status: "cancelled" } });
    // One mail for a class that moved, not a cancel and a booking.
    if (have) {
      const was = await MeetingRoom.findById(have.room).select("name").lean<{ name?: string } | null>();
      announceBooking(made._id, "moved", { room: was?.name, start: have.start, end: have.end });
    } else announceBooking(made._id, "booked");
    return { ok: true, booking: await asPod(made._id), changed: true };
  }
  if (have) {
    await MeetingBooking.updateOne({ _id: have._id }, { $set: { status: "cancelled" } });
    announceBooking(have._id, "cancelled");
  }
  return { ok: false, reason: "no_room", message: `No pod is free from ${input.start.toISOString()} to ${input.end.toISOString()}` };
}

/** The class no longer needs a pod: whatever it holds is let go. */
export async function releaseForClass(ref: string): Promise<{ released: number }> {
  const held = await MeetingBooking.find(scoped({ "source.system": LMS, "source.ref": ref, status: "booked" })).select("_id").lean();
  const r = await MeetingBooking.updateMany({ _id: { $in: held.map((h) => h._id) }, status: "booked" }, { $set: { status: "cancelled" } });
  for (const h of held) announceBooking(h._id, "cancelled");
  return { released: r.modifiedCount };
}

/** Every class the LMS holds a pod for, ending after `from` — so the LMS can let go of any it no longer needs. */
export async function lmsHolds(from: Date): Promise<Array<{ ref: string; bookingId: string; roomId: string; start: string; end: string }>> {
  const rows = await MeetingBooking.find(scoped({ "source.system": LMS, status: "booked", end: { $gt: from } })).select("source room start end").lean();
  return rows.map((b) => ({
    ref: String((b as unknown as { source: { ref: string } }).source.ref), bookingId: String(b._id), roomId: String(b.room),
    start: b.start.toISOString(), end: b.end.toISOString(),
  }));
}

async function asPod(id: unknown): Promise<PodBooking> {
  const b = await MeetingBooking.findById(id).lean();
  if (!b) throw bad("Booking vanished", 500);
  const mine = (await podBookings([String(b.room)], b.start, b.end)).find((x) => x.id === String(id));
  if (!mine) throw bad("Booking vanished", 500);
  return mine;
}
