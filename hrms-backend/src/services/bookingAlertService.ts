import { Organization } from "../models/Organization.js";
import { MeetingBooking } from "../models/MeetingBooking.js";
import { User } from "../models/User.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import { getOrgId } from "../utils/orgContext.js";

type What = "booked" | "moved" | "cancelled";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** The people the organisation has asked to hear about every booking. */
export async function bookingAlertRecipients(orgId?: unknown) {
  const org = await Organization.findById(orgId ?? getOrgId()).select("settings.bookingAlertUsers").lean<{ settings?: { bookingAlertUsers?: unknown[] } } | null>();
  const ids = org?.settings?.bookingAlertUsers ?? [];
  if (!ids.length) return [];
  return User.find({ _id: { $in: ids }, status: { $ne: "inactive" } }).select("name email").lean<Array<{ _id: unknown; name?: string; email?: string }>>();
}

/**
 * Email the booking-alert list about one booking: made, moved, or cancelled —
 * whether a person booked it here, a sales CRM did, or the LMS did for a
 * class. Never awaited by the caller and never throws: the booking stands
 * whatever happens to the mail. The organiser is not mailed about their own.
 */
export function announceBooking(bookingId: unknown, what: What, before?: { room?: string; start?: Date; end?: Date }) {
  const orgId = getOrgId();
  void (async () => {
    try {
      const people = await bookingAlertRecipients(orgId);
      if (!people.length) return;
      const b = await MeetingBooking.findById(bookingId)
        .populate("room", "name").populate("organizer", "name")
        .lean<{ _id: unknown; title: string; start: Date; end: Date; timeZone?: string; kind?: string; room?: { name?: string } | null; organizer?: { _id?: unknown; name?: string } | null; source?: { system?: string; label?: string } | null } | null>();
      if (!b?.room) return; // only rooms — an online or off-site review is not a room booking
      const tz = b.timeZone || "Asia/Dubai";
      const fmt = (s: Date, e: Date) =>
        `${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(s)}–` +
        new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(e);
      const room = b.room.name ?? "a room";
      const when = fmt(b.start, b.end);
      const title = b.kind === "review" ? "Review meeting" : b.title;
      const by = b.source?.system
        ? (b.source.label ? `${b.source.system.toUpperCase()} · ${b.source.label}` : b.source.system.toUpperCase())
        : b.organizer?.name ?? "—";
      const verb = what === "booked" ? "Room booked" : what === "moved" ? "Booking moved" : "Booking cancelled";
      const subject = `${verb}: ${room} · ${when}`;
      const was = what === "moved" && before?.start && before?.end ? `${before.room ?? room} · ${fmt(before.start, before.end)}` : "";
      const rows: Array<[string, string]> = [["Room", room], ["When", when], ...(was ? [["Was", was] as [string, string]] : []), ["Meeting", title], ["Booked by", by]];
      const html =
        `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
        `<h2 style="color:${what === "cancelled" ? "#b91c1c" : "#4f46e5"};margin-bottom:8px">${esc(verb)}</h2>` +
        `<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888">${esc(k)}</td><td style="padding:4px 0;color:#222${k === "Was" ? ";text-decoration:line-through" : ""}">${esc(v)}</td></tr>`).join("")}</table>` +
        `<p style="margin-top:16px"><a href="${env.CLIENT_URL}/meetings" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open meetings</a></p>` +
        `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS — you are on the booking alerts list.</p></div>`;
      const text = `${verb}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${env.CLIENT_URL}/meetings\n`;
      for (const p of people) {
        if (!p.email || String(p._id) === String(b.organizer?._id ?? "")) continue;
        await sendMail({ to: p.email, organization: String(orgId ?? ""), subject, html, text });
      }
    } catch (err) {
      console.error("📅 booking alert failed:", err instanceof Error ? err.message : err);
    }
  })();
}

/** The booking-alerts list, for the Rooms dialog. */
export async function getBookingAlertUsers() {
  return (await bookingAlertRecipients()).map((u) => ({ _id: String(u._id), name: u.name ?? "", email: u.email ?? "" }));
}

/** Replace the list. Only logins of this organisation are kept. */
export async function setBookingAlertUsers(userIds: string[]) {
  const orgId = getOrgId();
  const valid = await User.find({ _id: { $in: userIds }, organization: orgId, status: { $ne: "inactive" } }).select("_id").lean();
  await Organization.updateOne({ _id: orgId }, { $set: { "settings.bookingAlertUsers": valid.map((u) => u._id) } });
  return getBookingAlertUsers();
}
