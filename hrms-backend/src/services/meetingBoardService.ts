import { randomBytes } from "node:crypto";
import { Organization } from "../models/Organization.js";
import { MeetingBooking } from "../models/MeetingBooking.js";
import { getOrgId } from "../utils/orgContext.js";

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

const newToken = () => randomBytes(18).toString("base64url");

/**
 * The public meeting board — today's room bookings on a screen, no sign-in.
 *
 * The link carries a random code per organisation. It opens this board and
 * nothing else, and resetting it retires every copy handed out before.
 */
export class MeetingBoardService {
  /** The organisation's code, made the first time anyone asks for it. */
  async link() {
    const orgId = getOrgId();
    if (!orgId) throw fail("Choose an organisation first");
    const org = await Organization.findById(orgId).select("+meetingBoardToken").lean<{ meetingBoardToken?: string | null } | null>();
    if (!org) throw fail("Organisation not found", 404);
    if (org.meetingBoardToken) return { token: org.meetingBoardToken };
    const token = newToken();
    // Only set when still empty, so two people opening it at once agree on one code.
    await Organization.updateOne({ _id: orgId, meetingBoardToken: { $in: [null, undefined] } }, { $set: { meetingBoardToken: token } });
    const after = await Organization.findById(orgId).select("+meetingBoardToken").lean<{ meetingBoardToken?: string | null } | null>();
    return { token: after?.meetingBoardToken ?? token };
  }

  /** A new code; the old link stops working at once. */
  async resetLink() {
    const orgId = getOrgId();
    if (!orgId) throw fail("Choose an organisation first");
    const token = newToken();
    await Organization.updateOne({ _id: orgId }, { $set: { meetingBoardToken: token } });
    return { token };
  }

  /**
   * Today's bookings in rooms, in time order. Titles and organisers are shown;
   * a review meeting is only ever "Review meeting", with no names. Meetings
   * held online or elsewhere have no room and are not on the board.
   */
  async board(token: string, now = new Date()) {
    if (!/^[\w-]{16,64}$/.test(token)) throw fail("This board link is not valid", 404);
    const org = await Organization.findOne({ meetingBoardToken: token, status: "active" })
      .select("name settings.timeZone").lean<{ _id: unknown; name: string; settings?: { timeZone?: string } } | null>();
    if (!org) throw fail("This board link is not valid, or has been reset", 404);
    const timeZone = org.settings?.timeZone || "Asia/Dubai";
    const from = startOfToday(timeZone, now);
    const to = new Date(from.getTime() + 24 * 3600_000);

    const rows = await MeetingBooking.find({
      organization: org._id, room: { $ne: null }, status: { $in: ["booked", "cancelled"] },
      start: { $lt: to }, end: { $gt: from },
    })
      .populate("room", "name location")
      .populate("organizer", "name")
      .sort({ start: 1 })
      .lean<Array<{ _id: unknown; kind?: string; title: string; start: Date; end: Date; status: string; room?: { name?: string; location?: string } | null; organizer?: { name?: string } | null }>>();

    return {
      organization: org.name,
      timeZone,
      now,
      bookings: rows
        .filter((b) => b.end.getTime() > now.getTime() - KEEP_ENDED_MS)
        .map((b) => ({
          id: String(b._id),
          title: b.kind === "review" ? "Review meeting" : b.title,
          organiser: b.kind === "review" ? "" : b.organizer?.name ?? "",
          room: b.room?.name ?? "",
          location: b.room?.location ?? "",
          start: b.start,
          end: b.end,
          cancelled: b.status === "cancelled",
        })),
    };
  }
}
