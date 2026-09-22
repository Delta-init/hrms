import { MeetingBooking } from "../models/MeetingBooking.js";
import { MeetingRoom } from "../models/MeetingRoom.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import type {
  CreateRoomInput, UpdateRoomInput, CreateBookingInput, UpdateBookingInput,
} from "../validations/meetingValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { departmentsHeadedBy } from "./departmentHeadService.js";
import { stillHere } from "../utils/employeeStatus.js";
import { notify } from "./notificationService.js";

const POP = [
  { path: "room", select: "name location capacity" },
  { path: "organizer", select: "name email" },
  { path: "participants", select: "name email" },
];

export interface Actor {
  userId: string;
  roleName?: string;
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

  async listBookings(query: { from?: string; to?: string; room?: string; includeCancelled?: string }) {
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
    return MeetingBooking.find(filter).populate(POP).sort({ start: 1 }).lean();
  }

  async getBooking(id: string) {
    const record = await MeetingBooking.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    return record;
  }

  async createBooking(input: CreateBookingInput, actor: Actor) {
    const room = await MeetingRoom.findOne(scoped({ _id: input.room }));
    if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404 });
    if (!room.active) throw Object.assign(new Error("That room is no longer bookable"), { statusCode: 400 });

    const clash = await this.clashesWith(String(room._id), input.start, input.end);
    if (clash) {
      const who = (clash.organizer as unknown as { name?: string } | null)?.name ?? "someone";
      throw Object.assign(
        new Error(`${room.name} is already booked from ${clash.start.toISOString().slice(11, 16)} to ${clash.end.toISOString().slice(11, 16)} UTC by ${who}`),
        { statusCode: 409 }
      );
    }

    const record = await MeetingBooking.create({
      ...input,
      organization: getOrgId(),
      organizer: actor.userId,
    });

    await this.tellParticipants(String(record._id), input.participants, `${input.title} — you have been invited`, actor.userId);
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

    const clash = await this.clashesWith(String(input.room), input.start, input.end, String(record._id));
    if (clash) throw Object.assign(new Error("That room is already booked for part of this time"), { statusCode: 409 });

    /**
     * Moving a meeting un-fires its reminders.
     *
     * The stages are thresholds against the start time; leaving them ticked
     * after the start moves would mean a meeting pushed to the afternoon is
     * never announced again, having already "reminded" people about a time it
     * is no longer at.
     */
    const moved = record.start.getTime() !== new Date(input.start).getTime();
    await MeetingBooking.updateOne({ _id: record._id }, {
      $set: { ...input, ...(moved ? { firedStages: [] } : {}) },
    });
    return MeetingBooking.findById(record._id).populate(POP);
  }

  /** Cancelled rather than deleted: the room frees up, the record stays. */
  async cancelBooking(id: string, actor: Actor) {
    const record = await MeetingBooking.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    await this.assertCanManage(record, actor);

    await MeetingBooking.updateOne({ _id: record._id }, { $set: { status: "cancelled" } });
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
