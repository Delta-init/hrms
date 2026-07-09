import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { DashboardService } from "../services/dashboardService.js";
import { runBirthdayCheck } from "../jobs/birthdayJob.js";
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

/** Manually trigger the birthday check (email HR). Handy for testing SMTP. */
export const triggerBirthdayCheck = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await runBirthdayCheck();
    sendSuccess(res, "Birthday check executed", result);
  } catch (error) {
    next(error);
  }
};
