import type { Request, Response } from "express";
import { sendSuccess, sendError } from "../utils/response.js";
import { holdForClass, lmsHolds, podBookings, podsNamed, releaseForClass } from "../services/classPodService.js";
import { staffWorkModes } from "../services/staffLookupService.js";
import { bookCrmRoom, cancelCrmBooking, crmRoomDay } from "../services/crmRoomService.js";

/*
 * The LMS's class pods (services/classPodService.ts), behind the signed integration API and the caller's named
 * organization (serviceOrgScope).
 */
const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      sendError(res, (err as Error).message || "Integration request failed", status);
    });
  };

const list = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const date = (v: unknown) => {
  const d = new Date(String(v ?? ""));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** GET /integrations/meetings/pods?organizationId&names=Pod 4,Pod 6 → the active rooms by those names, in that order. */
export const listPods = asyncRoute(async (req, res) => {
  const names = list(req.query.names);
  if (!names.length || names.length > 50) { sendError(res, "names is required (at most 50)", 400); return; }
  sendSuccess(res, "Pods retrieved", await podsNamed(names));
});

/** GET /integrations/meetings/pod-bookings?organizationId&rooms=<ids>&from&to → every booking in them over that time (at most 62 days). */
export const listPodBookings = asyncRoute(async (req, res) => {
  const rooms = list(req.query.rooms);
  const from = date(req.query.from), to = date(req.query.to);
  if (!rooms.length || !from || !to || !(to > from)) { sendError(res, "rooms, from and to are required, to after from", 400); return; }
  if (to.getTime() - from.getTime() > 62 * 86_400_000) { sendError(res, "At most 62 days at a time", 400); return; }
  sendSuccess(res, "Bookings retrieved", await podBookings(rooms, from, to));
});

/** PUT /integrations/meetings/class-pods/:ref { organizationId, rooms[], start, end, title, label, organizerEmail? } */
export const holdClassPod = asyncRoute(async (req, res) => {
  const b = req.body ?? {};
  const start = date(b.start), end = date(b.end);
  if (!start || !end) { sendError(res, "start and end are required", 400); return; }
  const rooms = Array.isArray(b.rooms) ? b.rooms.map(String) : list(b.rooms);
  const r = await holdForClass({
    ref: String(req.params.ref ?? ""), roomIds: rooms, start, end, title: String(b.title ?? "Class"),
    label: String(b.label ?? "LMS class"), organizerEmail: b.organizerEmail ? String(b.organizerEmail) : undefined,
  });
  sendSuccess(res, r.ok ? "Pod held" : r.message, r);
});

/** DELETE /integrations/meetings/class-pods/:ref?organizationId → its pod let go. */
export const releaseClassPod = asyncRoute(async (req, res) => {
  sendSuccess(res, "Pod released", await releaseForClass(String(req.params.ref ?? "")));
});

/** GET /integrations/meetings/class-pods?organizationId&from → every class pod the LMS holds ending after `from`. */
export const listClassPods = asyncRoute(async (req, res) => {
  const from = date(req.query.from) ?? new Date();
  sendSuccess(res, "Class pods retrieved", await lmsHolds(from));
});

/* ── Where the LMS's mentors work (2026-10-19): services/staffLookupService.ts ── */

/** POST /integrations/directory/work-modes { people: [{ email, name? }], organizationId? } → each one's HRMS work mode, location and status. */
export const listWorkModes = asyncRoute(async (req, res) => {
  const b = req.body ?? {};
  const people = (Array.isArray(b.people) ? b.people : [])
    .map((p: { email?: unknown; name?: unknown }) => ({ email: String(p?.email ?? "").trim(), name: p?.name ? String(p.name).slice(0, 120) : undefined }))
    .filter((p: { email: string; name?: string }) => p.email || p.name);
  if (!people.length) { sendError(res, "people is required", 400); return; }
  if (people.length > 300) { sendError(res, "At most 300 people at a time", 400); return; }
  const org = String(b.organizationId ?? req.query.organizationId ?? "").trim() || undefined;
  sendSuccess(res, "Work modes retrieved", await staffWorkModes(people, org));
});

/* ── Meeting rooms for the sales CRMs (2026-10-19): services/crmRoomService.ts ── */

/** GET /integrations/meetings/crm-rooms?organizationId&crm&day=YYYY-MM-DD&viewerEmail → the CRM rooms and that day's bookings. */
export const crmRoomsDay = asyncRoute(async (req, res) => {
  sendSuccess(res, "Rooms retrieved", await crmRoomDay({
    crm: String(req.query.crm ?? ""), day: req.query.day ? String(req.query.day) : undefined,
    viewerEmail: req.query.viewerEmail ? String(req.query.viewerEmail) : undefined,
  }));
});

/** POST /integrations/meetings/crm-bookings { organizationId, crm, roomId, start, end, title, bookerEmail, bookerName } */
export const crmBook = asyncRoute(async (req, res) => {
  const b = req.body ?? {};
  const start = date(b.start), end = date(b.end);
  if (!start || !end) { sendError(res, "start and end are required", 400); return; }
  const booking = await bookCrmRoom({
    crm: String(b.crm ?? ""), roomId: String(b.roomId ?? ""), start, end, title: String(b.title ?? ""),
    bookerEmail: String(b.bookerEmail ?? ""), bookerName: String(b.bookerName ?? ""),
  });
  sendSuccess(res, "Room booked", booking, 201);
});

/** DELETE /integrations/meetings/crm-bookings/:id?organizationId&crm&bookerEmail[&any=1] → taken back. */
export const crmCancel = asyncRoute(async (req, res) => {
  sendSuccess(res, "Booking cancelled", await cancelCrmBooking({
    crm: String(req.query.crm ?? ""), id: String(req.params.id ?? ""), bookerEmail: String(req.query.bookerEmail ?? ""),
    any: String(req.query.any ?? "") === "1",
  }));
});
