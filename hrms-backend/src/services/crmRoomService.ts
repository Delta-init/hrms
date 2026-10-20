import { Types } from "mongoose";
import { MeetingBooking } from "../models/MeetingBooking.js";
import { User } from "../models/User.js";
import { getOrgId, scoped } from "../utils/orgContext.js";
import { heldBefore } from "../utils/roomClaim.js";
import { podsNamed, type PodRoom } from "./classPodService.js";

/*
 * Meeting rooms for the sales CRMs (the user, 2026-10-19: "the sales portals can book meeting room 1 and 2 only,
 * and see the bookings there — only by the hours of one day"). Each CRM shows one day of Meeting Room 1 and
 * Meeting Room 2 — every booking in them, whoever made it — and books a stretch inside that day's office hours for
 * the salesperson signed in there. Only those rooms, only one day, only office hours, never in the past, never on
 * top of another booking (the clash test, and the older-wins check after: utils/roomClaim.ts). A salesperson takes
 * back their own; a CRM's super admin any its CRM made. No HRMS reminders (a sourced booking has none).
 *
 * CRM_ROOMS (default "Meeting Room 1,Meeting Room 2") and CRM_ROOM_HOURS (default "10:00-19:00", Dubai) say which
 * rooms and when.
 */

const TZ = "Asia/Dubai";
const DUBAI_OFFSET_MS = 4 * 3_600_000; // no daylight saving
const CRMS: Record<string, string> = { sales: "Sales CRM", draw: "Draw CRM", remote: "Remote CRM" };
const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

export function crmRoomConfig() {
  const names = String(process.env.CRM_ROOMS ?? "Meeting Room 1,Meeting Room 2").split(",").map((s) => s.trim()).filter(Boolean);
  const m = String(process.env.CRM_ROOM_HOURS ?? "10:00-19:00").match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  const open = m ? Number(m[1]) * 60 + Number(m[2]) : 600;
  const close = m ? Number(m[3]) * 60 + Number(m[4]) : 1140;
  return { names, open, close: close > open ? close : 1140 };
}

/** Today on the Dubai calendar. */
export const dubaiToday = (now = new Date()) => new Date(now.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
/** A Dubai day's minute as a moment. */
const at = (day: string, minute: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) - DUBAI_OFFSET_MS + minute * 60_000);
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export interface CrmRoomBooking {
  id: string; roomId: string; roomName: string; start: string; end: string; title: string;
  /** The name shown for whoever has it. */
  holder: string;
  /** Made from this CRM by the person asking — theirs to take back. */
  mine: boolean;
  /** Made from this CRM (by anyone). */
  fromThisCrm: boolean;
}
export interface CrmRoomDay {
  day: string; timeZone: string; open: string; close: string;
  rooms: PodRoom[];
  bookings: CrmRoomBooking[];
}

const systemOf = (crm: string) => {
  const c = String(crm ?? "").trim().toLowerCase();
  if (!CRMS[c]) throw bad(`Unknown CRM "${crm}"`);
  return { code: c, system: `crm:${c}`, label: CRMS[c] };
};

/** One Dubai day of the CRM rooms: the rooms, and every booking in them that day. */
export async function crmRoomDay(input: { crm: string; day?: string; viewerEmail?: string }): Promise<CrmRoomDay> {
  const { system } = systemOf(input.crm);
  const day = input.day && DAY.test(input.day) ? input.day : dubaiToday();
  const cfg = crmRoomConfig();
  const rooms = await podsNamed(cfg.names);
  const from = at(day, 0), to = at(day, 24 * 60);
  const rows = rooms.length
    ? await MeetingBooking.find(scoped({ room: { $in: rooms.map((r) => new Types.ObjectId(r.id)) }, status: "booked", start: { $lt: to }, end: { $gt: from } }))
        .populate("room", "name").populate("organizer", "name").sort({ start: 1 }).lean()
    : [];
  const viewer = String(input.viewerEmail ?? "").trim().toLowerCase();
  return {
    day, timeZone: TZ, open: hhmm(cfg.open), close: hhmm(cfg.close), rooms,
    bookings: rows.map((b) => {
      const r = b as unknown as { _id: unknown; room?: { _id: unknown; name?: string } | null; organizer?: { name?: string } | null; source?: { system?: string; ref?: string; label?: string } | null; kind?: string; title: string };
      const fromThisCrm = r.source?.system === system;
      return {
        id: String(r._id), roomId: String(r.room?._id ?? ""), roomName: String(r.room?.name ?? ""),
        start: b.start.toISOString(), end: b.end.toISOString(),
        // A review is about one person: its title is not for another system's screens.
        title: r.kind === "review" ? "Review meeting" : r.title,
        holder: r.source?.label || r.organizer?.name || "",
        mine: fromThisCrm && !!viewer && String(r.source?.ref ?? "").toLowerCase() === viewer,
        fromThisCrm,
      };
    }),
  };
}

export interface CrmBookInput {
  crm: string; roomId: string; start: Date; end: Date; title: string; bookerEmail: string; bookerName: string;
}

/** Book one of the CRM rooms for a salesperson, inside one day's office hours. */
export async function bookCrmRoom(input: CrmBookInput, now = new Date()): Promise<CrmRoomBooking> {
  const { system, label } = systemOf(input.crm);
  const email = String(input.bookerEmail ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw bad("The booker's email is required");
  const name = String(input.bookerName ?? "").trim().slice(0, 80) || email;
  const title = String(input.title ?? "").trim().slice(0, 140);
  if (!title) throw bad("What is the meeting? A title is required");
  if (!(input.start instanceof Date) || !(input.end instanceof Date) || Number.isNaN(input.start.getTime()) || Number.isNaN(input.end.getTime())) throw bad("start and end are required");
  if (!(input.end > input.start)) throw bad("The meeting must end after it starts");

  const cfg = crmRoomConfig();
  const rooms = await podsNamed(cfg.names);
  const room = rooms.find((r) => r.id === input.roomId);
  if (!room) throw bad(`Only ${cfg.names.join(" and ")} can be booked from here`, 403);

  // One day, inside office hours, Dubai time.
  const day = dubaiToday(input.start);
  const minuteOf = (d: Date) => Math.round((d.getTime() - at(day, 0).getTime()) / 60_000);
  const s = minuteOf(input.start), e = minuteOf(input.end);
  if (e > 24 * 60) throw bad("A booking can't run past the end of the day");
  if (s < cfg.open || e > cfg.close) throw bad(`Rooms can be booked between ${hhmm(cfg.open)} and ${hhmm(cfg.close)} (Dubai)`);
  if (input.end.getTime() <= now.getTime()) throw bad("That time has already passed");
  if (input.start.getTime() < now.getTime() - 5 * 60_000) throw bad("Start from now or later");

  const clash = await MeetingBooking.findOne(scoped({ room: room.id, status: "booked", start: { $lt: input.end }, end: { $gt: input.start } }))
    .populate("organizer", "name").lean();
  if (clash) {
    const c = clash as unknown as { source?: { label?: string } | null; organizer?: { name?: string } | null };
    throw bad(`${room.name} is already booked then${c.source?.label || c.organizer?.name ? ` (${c.source?.label || c.organizer?.name})` : ""}`, 409);
  }
  const organizer = await User.findOne({ email, status: { $ne: "inactive" } }).select("_id").lean();
  const made = await MeetingBooking.create({
    organization: getOrgId(), room: new Types.ObjectId(room.id), title, start: input.start, end: input.end,
    timeZone: TZ, organizer: organizer?._id ?? null, participants: [], status: "booked", kind: "meeting", mode: "room",
    agenda: `Booked from the ${label} by ${name}.`, source: { system, ref: email, label: `${label} · ${name}`.slice(0, 120) },
  });
  // Somebody took it at the same moment and was first: this one goes.
  const first = await heldBefore(made._id, made.room, made.start, made.end);
  if (first) {
    await MeetingBooking.deleteOne({ _id: made._id });
    throw bad(`${room.name} was just booked by someone else`, 409);
  }
  const mine = (await crmRoomDay({ crm: input.crm, day, viewerEmail: email })).bookings.find((b) => b.id === String(made._id));
  if (!mine) throw bad("Booking vanished", 500);
  return mine;
}

/** Take a booking back: the salesperson's own, or — `any`, a CRM super admin — any this CRM made. */
export async function cancelCrmBooking(input: { crm: string; id: string; bookerEmail: string; any?: boolean }): Promise<{ cancelled: boolean }> {
  const { system } = systemOf(input.crm);
  if (!Types.ObjectId.isValid(input.id)) throw bad("Unknown booking", 404);
  const b = await MeetingBooking.findOne(scoped({ _id: input.id, status: "booked" })).lean();
  const src = (b as unknown as { source?: { system?: string; ref?: string } | null } | null)?.source;
  if (!b || src?.system !== system) throw bad("Only a booking made from this CRM can be taken back here", 404);
  const email = String(input.bookerEmail ?? "").trim().toLowerCase();
  if (!input.any && String(src.ref ?? "").toLowerCase() !== email) throw bad("Only the person who booked it can take it back", 403);
  const r = await MeetingBooking.updateOne({ _id: b._id, status: "booked" }, { $set: { status: "cancelled" } });
  return { cancelled: r.modifiedCount > 0 };
}
