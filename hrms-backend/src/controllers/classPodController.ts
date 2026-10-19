import type { Request, Response } from "express";
import { sendSuccess, sendError } from "../utils/response.js";
import { holdForClass, lmsHolds, podBookings, podsNamed, releaseForClass } from "../services/classPodService.js";

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
