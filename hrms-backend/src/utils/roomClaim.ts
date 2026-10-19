import { Types } from "mongoose";
import { MeetingBooking } from "../models/MeetingBooking.js";

/*
 * A room is held by whoever wrote first (2026-10-18).
 *
 * The clash test runs before a booking is written, and nothing makes the two one step — two people (or a person and
 * the LMS) pressing at the same moment could both pass it and both hold the room. So after writing, the booking looks
 * again: another one overlapping it in the same room that was made before it (an earlier id) means it lost, and it is
 * taken back. Of any two at once, exactly one stays.
 */

const overlapping = (room: unknown, start: Date, end: Date) => ({
  room, status: "booked", start: { $lt: end }, end: { $gt: start },
});

/** Another booking in this room over this stretch that was made before `id` — the one `id` loses to — or null. */
export async function heldBefore(id: unknown, room: unknown, start: Date, end: Date, besides: unknown[] = []) {
  const oid = new Types.ObjectId(String(id));
  return MeetingBooking.findOne({
    ...overlapping(room, start, end),
    _id: { $lt: oid, $nin: besides.map((b) => new Types.ObjectId(String(b))) },
  }).populate("organizer", "name").lean();
}

/** Any other booking in this room over this stretch — for a booking that kept its id while it moved. */
export async function heldBesides(id: unknown, room: unknown, start: Date, end: Date) {
  return MeetingBooking.findOne({ ...overlapping(room, start, end), _id: { $ne: new Types.ObjectId(String(id)) } })
    .populate("organizer", "name").lean();
}
