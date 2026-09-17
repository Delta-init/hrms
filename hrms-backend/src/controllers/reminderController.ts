import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ReminderService } from "../services/reminderService.js";
import { createReminderSchema } from "../validations/reminderValidation.js";
import { hasPermission } from "../middleware/permissions.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ReminderService();

export const createReminder = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createReminderSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }

    // Self and team reminders are self-service, same as raising leave — no
    // module permission needed. Reminding the whole org is the one case that
    // needs standing to speak to everyone, so it alone is gated.
    if (parsed.data.audience === "everyone" && !hasPermission(req.user!.role, "reminders", "approve")) {
      sendError(res, "You don't have permission to send a reminder to everyone", 403);
      return;
    }

    sendSuccess(res, "Reminder scheduled", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const listMyReminders = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Reminders retrieved", await service.mine(req.user!.userId)); } catch (error) { next(error); }
};

export const cancelReminder = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Reminder cancelled", await service.cancel(req.params.id, req.user!.userId)); } catch (error) { next(error); }
};
