import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { listFor, unreadCountFor, markRead, markAllRead } from "../services/notificationService.js";
import { sendSuccess, sendError } from "../utils/response.js";

/**
 * Everything here is about the caller and nobody else.
 *
 * There is no module permission and no "read somebody's notifications" route,
 * deliberately: the recipient is the authorisation. Adding a way for one person
 * to read another's would be adding a feature nobody asked for and a leak
 * somebody would eventually find.
 */

export const getNotifications = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Number(req.query.limit) || 30;
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    sendSuccess(res, "Notifications", await listFor(req.user!.userId, limit, before));
  } catch (error) { next(error); }
};

export const getUnreadCount = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Unread", { count: await unreadCountFor(req.user!.userId) });
  } catch (error) { next(error); }
};

export const readNotification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ok = await markRead(req.user!.userId, req.params.id);
    if (!ok) { sendError(res, "That notification no longer exists", 404); return; }
    sendSuccess(res, "Marked read", { id: req.params.id });
  } catch (error) { next(error); }
};

export const readAllNotifications = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "All marked read", { updated: await markAllRead(req.user!.userId) });
  } catch (error) { next(error); }
};
