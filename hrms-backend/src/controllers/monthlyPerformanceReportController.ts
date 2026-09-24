import type { NextFunction, Response } from "express";
import { MonthlyPerformanceReportService } from "../services/monthlyPerformanceReportService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { createMonthlyPerformanceReportSchema } from "../validations/monthlyPerformanceReportValidation.js";

const service = new MonthlyPerformanceReportService();

/** Filed by the employee themselves, or their department head. Multipart —
 *  the text and an optional file arrive in the same request. */
export const createReport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createMonthlyPerformanceReportSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(
      parsed.data,
      { userId: req.user!.userId, role: req.user!.role },
      req.file
    );
    sendSuccess(res, "Report filed", record, 201);
  } catch (error) { next(error); }
};

export const getMyReports = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as never);
    sendSuccess(res, "Reports retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getReports = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as never, { userId: req.user!.userId, role: req.user!.role });
    sendSuccess(res, "Reports retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

/** Who the caller may file a report for — themselves, plus their own team. */
export const getWhoCanFileFor = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Eligible employees retrieved", await service.whoCanFileFor(req.user!.userId));
  } catch (error) { next(error); }
};
