import { Organization } from "../models/Organization.js";
import { MeetingBooking } from "../models/MeetingBooking.js";
import { MeetingRoom } from "../models/MeetingRoom.js";

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Ended meetings stay on the board this long, dimmed, then drop off — like a departed flight. */
const KEEP_ENDED_MS = 30 * 60_000;

/** Midnight today, where the organisation is, as an instant. */
function startOfToday(timeZone: string, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = wall - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset);
}

/**
 * The public meeting board — today's room bookings on a screen, at a plain
 * address anyone can open. It shows the main organisation: the first one set
 * up, which is the office the screens are in.
 *
 * Titles and organisers are shown; a review meeting is only ever "Review
 * meeting", with no names. Meetings held online or elsewhere have no room and
 * are not on the board.
 */
export class MeetingBoardService {
  async board(now = new Date()) {
    const org = await Organization.findOne({ status: "active" }).sort({ createdAt: 1 })
      .select("name settings.timeZone").lean<{ _id: unknown; name: string; settings?: { timeZone?: string } } | null>();
    if (!org) throw fail("There is no organisation to show", 404);
    const timeZone = org.settings?.timeZone || "Asia/Dubai";
    const from = startOfToday(timeZone, now);
    const to = new Date(from.getTime() + 24 * 3600_000);

    const [rooms, rows] = await Promise.all([
      MeetingRoom.find({ organization: org._id, active: true }).select("name").lean<Array<{ name: string }>>(),
      MeetingBooking.find({
        organization: org._id, room: { $ne: null }, status: { $in: ["booked", "cancelled"] },
        start: { $lt: to }, end: { $gt: from },
      })
        .populate("room", "name")
        .populate("organizer", "name")
        .sort({ start: 1 })
        .lean<Array<{ _id: unknown; kind?: string; title: string; start: Date; end: Date; status: string; room?: { name?: string } | null; organizer?: { name?: string } | null }>>(),
    ]);

    return {
      organization: org.name,
      timeZone,
      now,
      // Natural order, so Pod 2 comes before Pod 10.
      rooms: rooms.map((r) => r.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
      bookings: rows
        .filter((b) => b.end.getTime() > now.getTime() - KEEP_ENDED_MS)
        .map((b) => ({
          id: String(b._id),
          title: b.kind === "review" ? "Review meeting" : b.title,
          organiser: b.kind === "review" ? "" : b.organizer?.name ?? "",
          room: b.room?.name ?? "",
          start: b.start,
          end: b.end,
          cancelled: b.status === "cancelled",
        })),
    };
  }
}
