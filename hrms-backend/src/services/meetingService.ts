import { MeetingBooking } from "../models/MeetingBooking.js";
import { MeetingRoom } from "../models/MeetingRoom.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import type {
  CreateRoomInput, UpdateRoomInput, CreateBookingInput, UpdateBookingInput, ReviewFormInput,
} from "../validations/meetingValidation.js";
import { headsDepartmentOf } from "./departmentHeadService.js";
import { hasPermission } from "../middleware/permissions.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { departmentsHeadedBy } from "./departmentHeadService.js";
import { stillHere } from "../utils/employeeStatus.js";
import { notify } from "./notificationService.js";
import { heldBefore, heldBesides } from "../utils/roomClaim.js";
import { announceBooking } from "./bookingAlertService.js";

const POP = [
  { path: "room", select: "name location capacity" },
  { path: "organizer", select: "name email" },
  { path: "participants", select: "name email" },
  { path: "reviewee", select: "name employeeCode designation" },
  { path: "revieweeUser", select: "name email" },
  { path: "joins.user", select: "name" },
];

export interface Actor {
  userId: string;
  roleName?: string;
  /** The caller's role, for "is this HR" — absent for internal callers. */
  role?: Parameters<typeof hasPermission>[0];
}

const idOf = (v: unknown) => String((v as { _id?: unknown } | null)?._id ?? v ?? "");

/**
 * Who may see a review meeting in full — the person reviewed, whoever is in
 * the meeting, their department head(s) and HR. Everyone else sees only that
 * the slot is taken: a review is about one person and is nobody else's to read.
 */
async function canSeeReview(b: { organizer: unknown; participants?: unknown[]; revieweeUser?: unknown }, actor: Actor) {
  if (actor.roleName === "Super Admin") return true;
  if (actor.role && (hasPermission(actor.role, "performance", "edit") || hasPermission(actor.role, "meetings", "edit"))) return true;
  const me = String(actor.userId);
  if (idOf(b.organizer) === me || idOf(b.revieweeUser) === me) return true;
  if ((b.participants ?? []).some((p) => idOf(p) === me)) return true;
  return b.revieweeUser ? headsDepartmentOf(me, idOf(b.revieweeUser)) : false;
}

const isHr = (actor: Actor) =>
  actor.roleName === "Super Admin" ||
  !!(actor.role && (hasPermission(actor.role, "performance", "edit") || hasPermission(actor.role, "meetings", "edit")));

/** Within this of today's clock-in counts as the same place. */
const SAME_PLACE_M = 200;

/** Straight-line distance between two points, in metres. */
function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** The join link opens this long before the start, and closes at the end. */
const OPENS_BEFORE_MS = 10 * 60_000;

/** The address an online review meeting is joined through — HRMS first, the meeting after. */
const joinUrl = (id: unknown) => `${env.CLIENT_URL}/meet/${String(id)}`;

/**
 * An online review meeting as one viewer may see it. The real link is the
 * organiser's alone — everyone else goes through the join page, which checks
 * where they are first — and the join log is for the organiser, HR and the
 * employee's department head.
 */
async function forViewer<T extends Record<string, unknown>>(b: T, actor: Actor): Promise<T> {
  if (b.kind !== "review" || b.restricted) return b;
  const me = String(actor.userId);
  const organiser = idOf(b.organizer) === me || actor.roleName === "Super Admin";
  const out: Record<string, unknown> = { ...b };
  if (b.mode === "online" && !organiser) {
    out.hasLink = !!b.meetingLink;
    out.meetingLink = "";
  }
  const seesJoins = organiser || isHr(actor) || (b.revieweeUser ? await headsDepartmentOf(me, idOf(b.revieweeUser)) : false);
  if (!seesJoins) out.joins = [];
  out.joinsVisible = seesJoins;
  return out as T;
}

/** A review meeting as someone outside it sees it: the time is taken, nothing more. */
function masked<T extends Record<string, unknown>>(b: T): T {
  return {
    ...b,
    title: "Review meeting",
    agenda: "",
    meetingLink: "",
    placeAddress: "",
    placeMapUrl: "",
    recordingLink: "",
    reviewee: null,
    revieweeUser: null,
    participants: [],
    review: null,
    joins: [],
    restricted: true,
  };
}

export class MeetingService {
  // ── Rooms ──────────────────────────────────────────────────────────────────

  async listRooms(includeInactive = false) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (!includeInactive) filter.active = true;
    return MeetingRoom.find(filter).sort({ name: 1 }).lean();
  }

  async createRoom(input: CreateRoomInput) {
    const existing = await MeetingRoom.findOne(scoped({ name: input.name.trim() }));
    if (existing) throw Object.assign(new Error("A room with this name already exists"), { statusCode: 409 });
    return MeetingRoom.create({ ...input, organization: getOrgId() });
  }

  async updateRoom(id: string, input: UpdateRoomInput) {
    const room = await MeetingRoom.findOne(scoped({ _id: id }));
    if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404 });
    await MeetingRoom.updateOne({ _id: room._id }, { $set: input });
    return MeetingRoom.findById(room._id).lean();
  }

  /**
   * Retire a room rather than delete it.
   *
   * Bookings already made still point at it, and a meeting whose room has
   * vanished is worse than one in a room nobody books any more.
   */
  async retireRoom(id: string) {
    const room = await MeetingRoom.findOne(scoped({ _id: id }));
    if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404 });
    await MeetingRoom.updateOne({ _id: room._id }, { $set: { active: false } });
    return { message: "Room retired" };
  }

  // ── Bookings ───────────────────────────────────────────────────────────────

  /**
   * Whether this room is already spoken for over that stretch.
   *
   * Two bookings clash when each starts before the other ends — the standard
   * overlap test, and deliberately not "same start time": the failure this
   * guards against is somebody booking 10:30 in a room held from 10:00 to
   * 11:00, which a start-time check waves through.
   *
   * Touching ends do not clash. A meeting ending at 11:00 and the next
   * starting at 11:00 is how a room is meant to be used.
   */
  private async clashesWith(room: string, start: Date, end: Date, excludeId?: string) {
    return MeetingBooking.findOne(
      scoped({
        room,
        status: "booked",
        start: { $lt: end },
        end: { $gt: start },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
    )
      .populate("organizer", "name")
      .lean();
  }

  /** Employees with a login, for the participant picker. */
  async invitableUsers() {
    const employees = await Employee.find(scoped({ status: stillHere(), user: { $ne: null } }))
      .select("user name employeeCode")
      .lean();
    const users = await User.find({ _id: { $in: employees.map((e) => e.user) }, status: { $ne: "inactive" } })
      .select("name email")
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return employees
      .filter((e) => byId.has(String(e.user)))
      .map((e) => ({
        _id: String(e.user),
        name: String(e.name),
        employeeCode: e.employeeCode,
        email: byId.get(String(e.user))!.email,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listBookings(query: { from?: string; to?: string; room?: string; includeCancelled?: string }, actor?: Actor) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.room) filter.room = query.room;
    if (query.includeCancelled !== "true") filter.status = "booked";

    // Anything overlapping the window, not merely starting inside it — a
    // meeting running across midnight belongs to both days it touches.
    if (query.from || query.to) {
      const from = query.from ? new Date(query.from) : new Date(0);
      const to = query.to ? new Date(query.to) : new Date(8640000000000000);
      filter.start = { $lt: to };
      filter.end = { $gt: from };
    }
    const rows = await MeetingBooking.find(filter).populate(POP).sort({ start: 1 }).lean();
    if (!actor) return rows;
    return Promise.all(rows.map(async (b) =>
      b.kind === "review" && !(await canSeeReview(b, actor)) ? masked(b as never) : forViewer(b as never, actor)
    ));
  }

  async getBooking(id: string, actor?: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id })).populate(POP).lean();
    if (!record) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    if (actor && record.kind === "review" && !(await canSeeReview(record, actor))) return masked(record as never);
    return actor ? forViewer(record as never, actor) : record;
  }

  /**
   * Where a booking happens, checked and normalised. A room is looked up and
   * its clash test run; online and elsewhere need neither. A review meeting
   * resolves the person reviewed and puts them on the invite list.
   */
  private async placeFor(input: CreateBookingInput, excludeId?: string, keepLinkFrom?: string) {
    const out: Record<string, unknown> = {
      kind: input.kind, mode: input.mode,
      room: null, meetingLink: "", placeAddress: "", placeMapUrl: "",
      reviewee: null, revieweeUser: null,
    };
    if (input.mode === "room") {
      const room = await MeetingRoom.findOne(scoped({ _id: input.room }));
      if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404 });
      if (!room.active) throw Object.assign(new Error("That room is no longer bookable"), { statusCode: 400 });
      const clash = await this.clashesWith(String(room._id), input.start, input.end, excludeId);
      if (clash) {
        const who = (clash.organizer as unknown as { name?: string } | null)?.name ?? "someone";
        throw Object.assign(
          new Error(`${room.name} is already booked from ${clash.start.toISOString().slice(11, 16)} to ${clash.end.toISOString().slice(11, 16)} UTC by ${who}`),
          { statusCode: 409 }
        );
      }
      out.room = room._id;
    } else if (input.mode === "online") {
      // Blank on an edit keeps the saved link — only its organiser is ever shown it.
      out.meetingLink = input.meetingLink || keepLinkFrom || "";
      if (!out.meetingLink) throw Object.assign(new Error("Add the meeting link"), { statusCode: 400 });
    } else {
      out.placeAddress = input.placeAddress;
      out.placeMapUrl = input.placeMapUrl ?? "";
    }

    let participants = [...new Set((input.participants ?? []).map(String))];
    if (input.kind === "review") {
      const emp = await Employee.findOne(scoped({ user: input.revieweeUser, status: stillHere() })).select("_id user").lean<{ _id: unknown; user: unknown } | null>();
      if (!emp) throw Object.assign(new Error("That person is not a current employee with a login"), { statusCode: 400 });
      out.reviewee = emp._id;
      out.revieweeUser = emp.user;
      if (!participants.includes(String(emp.user))) participants = [String(emp.user), ...participants];
    }
    out.participants = participants;
    return out;
  }

  async createBooking(input: CreateBookingInput, actor: Actor) {
    const place = await this.placeFor(input);
    const record = await MeetingBooking.create({
      title: input.title, agenda: input.agenda, start: input.start, end: input.end, timeZone: input.timeZone,
      ...place,
      organization: getOrgId(),
      organizer: actor.userId,
    });
    // Somebody took the room at the same moment, and got there first: this one goes (utils/roomClaim.ts).
    if (record.room) {
      const first = await heldBefore(record._id, record.room, record.start, record.end);
      if (first) {
        await MeetingBooking.deleteOne({ _id: record._id });
        throw Object.assign(new Error(`That room was just booked from ${first.start.toISOString().slice(11, 16)} to ${first.end.toISOString().slice(11, 16)} UTC — pick another time or room`), { statusCode: 409 });
      }
    }

    if (place.room) announceBooking(record._id, "booked");
    // In-app only: an online review's mail goes at the start, with the join link.
    await this.tellParticipants(String(record._id), place.participants as string[], `${input.title} — you have been invited`, actor.userId);
    return MeetingBooking.findById(record._id).populate(POP);
  }

  /**
   * Who may change or cancel a booking.
   *
   * The organiser, because it is theirs; a department head, because somebody
   * has to be able to free a room when the person who booked it is away; and
   * Super Admin, which already decides everything else.
   */
  async canManage(booking: { organizer: unknown }, actor: Actor): Promise<boolean> {
    // The organiser arrives as an id from a bare read and as a document from a
    // populated one, and both reach here — comparing the raw value works for
    // the first and silently never matches for the second.
    const organizerId = String((booking.organizer as { _id?: unknown } | null)?._id ?? booking.organizer);
    if (organizerId === String(actor.userId)) return true;
    if (actor.roleName === "Super Admin") return true;
    return (await departmentsHeadedBy(actor.userId)).length > 0;
  }

  private async assertCanManage(booking: { organizer: unknown }, actor: Actor) {
    if (await this.canManage(booking, actor)) return;
    throw Object.assign(
      new Error("Only the organiser, a department head or an administrator can change this booking"),
      { statusCode: 403 }
    );
  }

  async updateBooking(id: string, input: UpdateBookingInput, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    await this.assertCanManage(record, actor);

    const place = await this.placeFor(input, String(record._id), record.meetingLink || undefined);
    const changed =
      record.start.getTime() !== new Date(input.start).getTime() ||
      record.end.getTime() !== new Date(input.end).getTime() ||
      (record.meetingLink ?? "") !== (place.meetingLink ?? "") ||
      (record.mode ?? "room") !== place.mode;

    /**
     * Moving a meeting un-fires its reminders.
     *
     * The stages are thresholds against the start time; leaving them ticked
     * after the start moves would mean a meeting pushed to the afternoon is
     * never announced again, having already "reminded" people about a time it
     * is no longer at.
     */
    const moved = record.start.getTime() !== new Date(input.start).getTime();
    const roomBefore = record.room ? await MeetingRoom.findById(record.room).select("name").lean<{ name?: string } | null>() : null;
    const wasAt = { room: roomBefore?.name, start: record.start, end: record.end };
    const roomMoved = String(record.room ?? "") !== String(place.room ?? "") ||
      record.start.getTime() !== new Date(input.start).getTime() || record.end.getTime() !== new Date(input.end).getTime();
    const before = record.toObject();
    await MeetingBooking.updateOne({ _id: record._id }, {
      $set: {
        title: input.title, agenda: input.agenda, start: input.start, end: input.end, timeZone: input.timeZone,
        ...place,
        ...(moved ? { firedStages: [] } : {}),
      },
    });
    // Somebody took the room at the same moment: put this one back as it was (utils/roomClaim.ts).
    if (place.room) {
      const other = await heldBesides(record._id, place.room, new Date(input.start), new Date(input.end));
      if (other) {
        await MeetingBooking.replaceOne({ _id: record._id }, before);
        throw Object.assign(new Error(`That room was just booked from ${other.start.toISOString().slice(11, 16)} to ${other.end.toISOString().slice(11, 16)} UTC — pick another time or room`), { statusCode: 409 });
      }
    }
    if (place.room && roomMoved) announceBooking(record._id, record.room ? "moved" : "booked", record.room ? wasAt : undefined);
    // Moved, or a new link: an in-app word now; the mail still goes at the (new) start.
    if (changed && place.kind === "review" && place.mode === "online") {
      await this.tellParticipants(String(record._id), place.participants as string[], `${input.title} — the time or link changed`, actor.userId);
    }
    return forViewer((await MeetingBooking.findById(record._id).populate(POP).lean()) as never, actor);
  }

  /** Cancelled rather than deleted: the room frees up, the record stays. */
  async cancelBooking(id: string, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    await this.assertCanManage(record, actor);

    await MeetingBooking.updateOne({ _id: record._id }, { $set: { status: "cancelled" } });
    if (record.room) announceBooking(record._id, "cancelled");
    await this.mailParticipants(String(record._id), "cancel");
    await this.tellParticipants(String(record._id), record.participants.map(String), `${record.title} — cancelled`, actor.userId);
    return { message: "Booking cancelled" };
  }

  async removeBooking(id: string, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    await this.assertCanManage(record, actor);
    await MeetingBooking.deleteOne({ _id: record._id });
    return { message: "Booking deleted" };
  }

  /**
   * The review form, after the meeting. Written by the organiser (or Super
   * Admin); saving it marks the meeting held and tells the person reviewed.
   * Can be rewritten until they acknowledge it.
   */
  async saveReview(id: string, input: ReviewFormInput, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    if (record.kind !== "review") throw Object.assign(new Error("Only a review meeting has a review"), { statusCode: 400 });
    if (record.status === "cancelled") throw Object.assign(new Error("This meeting was cancelled"), { statusCode: 400 });
    if (idOf(record.organizer) !== String(actor.userId) && actor.roleName !== "Super Admin") {
      throw Object.assign(new Error("Only the person who held the review can write it"), { statusCode: 403 });
    }
    if (record.review?.acknowledgedAt) throw Object.assign(new Error("The employee has already acknowledged this review"), { statusCode: 400 });
    if (record.start.getTime() > Date.now()) throw Object.assign(new Error("The meeting hasn't started yet"), { statusCode: 400 });

    const first = !record.review?.writtenAt;
    record.review = {
      rating: input.rating,
      strengths: input.strengths,
      improvements: input.improvements,
      actions: input.actions.map((a) => ({ text: a.text, dueDate: a.dueDate ? new Date(`${a.dueDate}T00:00:00.000Z`) : null })),
      outcome: input.outcome,
      writtenBy: actor.userId as never,
      writtenAt: new Date(),
      acknowledgedAt: null,
    } as never;
    if (input.recordingLink !== undefined) record.recordingLink = input.recordingLink;
    record.heldAt = record.heldAt ?? new Date();
    await record.save();

    if (record.revieweeUser) {
      const title = first ? `Your review is ready — ${record.title}` : `Your review was updated — ${record.title}`;
      try {
        await notify({ users: [String(record.revieweeUser)], kind: "reminder", title, body: "Open it in Meetings to read and acknowledge it.", href: "/meetings", actor: actor.userId });
      } catch { /* the mail below */ }
      const who = await User.findById(record.revieweeUser).select("email").lean<{ email?: string } | null>();
      if (who?.email) {
        try {
          await sendMail({
            to: who.email,
            organization: String(getOrgId() ?? ""),
            subject: title,
            text: `${title}\n\nOpen it in Meetings to read and acknowledge it.\n\n${env.CLIENT_URL}/meetings\n`,
            html:
              `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
              `<h2 style="color:#4f46e5;margin-bottom:4px">${title}</h2><p style="color:#555">Open it in Meetings to read and acknowledge it.</p>` +
              `<p><a href="${env.CLIENT_URL}/meetings" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open meetings</a></p></div>`,
          });
        } catch { /* the review stands either way */ }
      }
    }
    return forViewer((await MeetingBooking.findById(record._id).populate(POP).lean()) as never, actor);
  }

  /** The recording link — added or changed by whoever may manage the meeting, any time after it. */
  async setRecording(id: string, recordingLink: string, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    await this.assertCanManage(record, actor);
    record.recordingLink = recordingLink;
    await record.save();
    return forViewer((await MeetingBooking.findById(record._id).populate(POP).lean()) as never, actor);
  }

  /** The person reviewed has read it. */
  async acknowledgeReview(id: string, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    if (idOf(record.revieweeUser) !== String(actor.userId)) throw Object.assign(new Error("Only the person reviewed can acknowledge it"), { statusCode: 403 });
    if (!record.review?.writtenAt) throw Object.assign(new Error("There is no review to acknowledge yet"), { statusCode: 400 });
    if (!record.review.acknowledgedAt) {
      record.review.acknowledgedAt = new Date();
      record.markModified("review");
      await record.save();
      try {
        await notify({ users: [idOf(record.organizer)], kind: "reminder", title: `Review acknowledged — ${record.title}`, body: "", href: "/meetings", actor: actor.userId });
      } catch { /* nothing hangs on it */ }
    }
    return forViewer((await MeetingBooking.findById(record._id).populate(POP).lean()) as never, actor);
  }

  /**
   * Email everyone in an online review meeting with the HRMS join link, never
   * the meeting link itself — at the start (from the reminder job, organiser
   * included), and when it is cancelled. Booking and moving it are in-app
   * only: the one mail that matters is the one that arrives as it begins.
   */
  async mailParticipants(id: string, why: "start" | "cancel") {
    try {
      const b = await MeetingBooking.findById(id)
        .populate([{ path: "participants", select: "name email status" }, { path: "organizer", select: "name email status" }, { path: "reviewee", select: "name" }])
        .lean<Record<string, any> | null>();
      if (!b || b.kind !== "review" || b.mode !== "online") return;
      const tz = b.timeZone || "Asia/Dubai";
      const when = `${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(b.start))}` +
        ` – ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(b.end))} (${tz})`;
      const subject = why === "cancel" ? `Cancelled: ${b.title}` : `Starting now: ${b.title}`;
      const lead = why === "cancel" ? "This review meeting has been cancelled." : "Your review meeting is starting now. Join through the button below.";
      const link = joinUrl(b._id);
      // At the start the organiser joins the same way; a cancellation is theirs, so they are spared it.
      const people = [...(why === "start" && b.organizer ? [b.organizer] : []), ...(b.participants ?? [])];
      const seen = new Set<string>();
      const recipients = people.filter((p: any) => {
        const key = String(p?._id);
        if (!p?.email || p.status === "inactive" || seen.has(key)) return false;
        if (why === "cancel" && key === String(b.organizer?._id)) return false;
        seen.add(key);
        return true;
      });
      for (const p of recipients) {
        await sendMail({
          to: p.email,
          organization: String(b.organization ?? getOrgId() ?? ""),
          subject,
          text: `${lead}\n\n${b.title}\n${when}\nReviewing: ${b.reviewee?.name ?? "—"} · Reviewer: ${b.organizer?.name ?? "—"}\n` +
            (why === "cancel" ? "" : `\nJoin: ${link}\nYou'll be asked to share your location, then taken to the meeting.\n`),
          html:
            `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
            `<h2 style="color:#4f46e5;margin-bottom:4px">${subject}</h2><p style="color:#555">${lead}</p>` +
            `<p style="color:#333"><strong>${b.title}</strong><br>${when}<br>Reviewing: ${b.reviewee?.name ?? "—"} · Reviewer: ${b.organizer?.name ?? "—"}</p>` +
            (why === "cancel" ? "" :
              `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Join meeting</a></p>` +
              `<p style="color:#888;font-size:12px">You'll be asked to share your location, then taken to the meeting.</p>`) +
            `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
        });
      }
    } catch (err) {
      console.error(`meetings: could not email participants of ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Opening an online review meeting through HRMS: record where the person is
   * against where they clocked in today, then hand over the meeting link.
   *
   * No location, no link — the page asks for it before calling this. Not
   * having clocked in does not stop anyone; it is recorded and shown.
   */
  async join(id: string, coords: { latitude: number; longitude: number; accuracy?: number | null }, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    if (record.kind !== "review" || record.mode !== "online" || !record.meetingLink) {
      throw Object.assign(new Error("This meeting is not joined online"), { statusCode: 400 });
    }
    if (record.status === "cancelled") throw Object.assign(new Error("This meeting was cancelled"), { statusCode: 400 });
    const me = String(actor.userId);
    const invited = idOf(record.organizer) === me || (record.participants ?? []).some((p) => idOf(p) === me);
    if (!invited) throw Object.assign(new Error("You are not invited to this meeting"), { statusCode: 403 });

    const now = Date.now();
    if (now < record.start.getTime() - OPENS_BEFORE_MS) {
      const opens = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: record.timeZone || "Asia/Dubai" })
        .format(new Date(record.start.getTime() - OPENS_BEFORE_MS));
      throw Object.assign(new Error(`The meeting opens at ${opens}`), { statusCode: 400 });
    }
    if (now > record.end.getTime()) throw Object.assign(new Error("This meeting has ended"), { statusCode: 400 });
    const lateMinutes = Math.max(0, Math.floor((now - record.start.getTime()) / 60_000));

    // Today's clock-in: the latest record whose first punch was in the last day.
    const since = new Date(Date.now() - 20 * 3600_000);
    const att = await Attendance.findOne({ user: actor.userId, checkIn: { $gte: since } })
      .sort({ checkIn: -1 }).select("sessions").lean<{ sessions?: Array<{ checkInSource?: { latitude?: number | null; longitude?: number | null } | null }> } | null>();
    const src = att?.sessions?.[0]?.checkInSource;
    const clockAt = src?.latitude != null && src?.longitude != null ? { latitude: src.latitude, longitude: src.longitude } : null;
    const distanceMetres = clockAt ? metresBetween(clockAt, coords) : null;

    record.joins = [...(record.joins ?? []), {
      user: actor.userId as never,
      at: new Date(),
      latitude: Math.round(coords.latitude * 1e5) / 1e5,
      longitude: Math.round(coords.longitude * 1e5) / 1e5,
      accuracy: coords.accuracy ?? null,
      clockedIn: !!att,
      distanceMetres,
      sameLocation: distanceMetres === null ? null : distanceMetres <= SAME_PLACE_M,
      lateMinutes,
    }] as never;
    await record.save();
    return { meetingLink: record.meetingLink, clockedIn: !!att, distanceMetres, sameLocation: distanceMetres === null ? null : distanceMetres <= SAME_PLACE_M, lateMinutes };
  }

  /** In-app only; the mail is the reminder job's, so an invite is not two mails. */
  private async tellParticipants(bookingId: string, participants: string[], title: string, actorId: string) {
    const users = (participants ?? []).map(String).filter((id) => id !== String(actorId));
    if (!users.length) return;
    try {
      await notify({ users, kind: "reminder", title, body: "", href: "/meetings", actor: actorId });
    } catch {
      /* the booking stands whether or not the bell rang */
    }
  }
}
