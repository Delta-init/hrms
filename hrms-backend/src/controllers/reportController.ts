import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ReportService } from "../services/reportService.js";
import { runReportSchema } from "../validations/reportValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ReportService();

export const getReportSources = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Report sources retrieved", await service.listSources());
  } catch (error) { next(error); }
};

export const runReport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = runReportSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Report generated", await service.run(parsed.data));
  } catch (error) { next(error); }
};
