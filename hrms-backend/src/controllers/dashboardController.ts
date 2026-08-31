import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { DashboardService } from "../services/dashboardService.js";
import { runBirthdayCheck } from "../jobs/birthdayJob.js";
import { DEFAULT_EXPIRY_WINDOW_DAYS } from "../services/documentOverviewService.js";
import { sendSuccess } from "../utils/response.js";

const service = new DashboardService();

export const getDashboardSummary = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await service.summary();
    sendSuccess(res, "Dashboard summary retrieved", data);
  } catch (error) {
    next(error);
  }
};

/** Self-service — today's birthdays/anniversaries, visible to every employee. */
export const getWishesToday = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Today's wishes retrieved", await service.wishesToday());
  } catch (error) { next(error); }
};

export const getDocumentExpiry = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const fallback = String(DEFAULT_EXPIRY_WINDOW_DAYS);
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? fallback), 10) || DEFAULT_EXPIRY_WINDOW_DAYS));
    sendSuccess(res, "Document expiry retrieved", await service.documentExpiry(days));
  } catch (error) { next(error); }
};

export const getOrgChart = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Org chart retrieved", await service.orgChart());
  } catch (error) { next(error); }
};

/** Manually trigger the birthday check (email HR). Handy for testing SMTP. */
export const triggerBirthdayCheck = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await runBirthdayCheck();
    sendSuccess(res, "Birthday check executed", result);
  } catch (error) {
    next(error);
  }
};
