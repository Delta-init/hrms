import type { NextFunction, Response } from "express";
import { MeetingService, type Actor } from "../services/meetingService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import {
  createRoomSchema, updateRoomSchema, createBookingSchema, updateBookingSchema,
} from "../validations/meetingValidation.js";

const service = new MeetingService();
const actorOf = (req: AuthenticatedRequest): Actor => ({
  userId: req.user!.userId,
  roleName: req.user?.role?.roleName,
});

const parsed = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { flatten: () => { fieldErrors: unknown } } } }, req: AuthenticatedRequest, res: Response) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    sendError(res, "Validation failed", 400, r.error!.flatten().fieldErrors as never);
    return null;
  }
  return r.data!;
};

// ── Rooms ────────────────────────────────────────────────────────────────────

export const getRooms = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Rooms retrieved", await service.listRooms(req.query.includeInactive === "true"));
  } catch (error) { next(error); }
};

export const createRoom = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = parsed(createRoomSchema as never, req, res); if (!data) return;
    sendSuccess(res, "Room created", await service.createRoom(data as never), 201);
  } catch (error) { next(error); }
};

export const updateRoom = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = parsed(updateRoomSchema as never, req, res); if (!data) return;
    sendSuccess(res, "Room updated", await service.updateRoom(String(req.params.id), data as never));
  } catch (error) { next(error); }
};

export const retireRoom = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Room retired", await service.retireRoom(String(req.params.id)));
  } catch (error) { next(error); }
};

// ── Bookings ─────────────────────────────────────────────────────────────────

export const getInvitable = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "People retrieved", await service.invitableUsers());
  } catch (error) { next(error); }
};

export const getBookings = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Bookings retrieved", await service.listBookings(req.query as never));
  } catch (error) { next(error); }
};

export const getBookingById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Booking retrieved", await service.getBooking(String(req.params.id)));
  } catch (error) { next(error); }
};

export const createBooking = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = parsed(createBookingSchema as never, req, res); if (!data) return;
    sendSuccess(res, "Room booked", await service.createBooking(data as never, actorOf(req)), 201);
  } catch (error) { next(error); }
};

export const updateBooking = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = parsed(updateBookingSchema as never, req, res); if (!data) return;
    sendSuccess(res, "Booking updated", await service.updateBooking(String(req.params.id), data as never, actorOf(req)));
  } catch (error) { next(error); }
};

export const cancelBooking = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Booking cancelled", await service.cancelBooking(String(req.params.id), actorOf(req)));
  } catch (error) { next(error); }
};

export const deleteBooking = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Booking deleted", await service.removeBooking(String(req.params.id), actorOf(req)));
  } catch (error) { next(error); }
};
