import type { NextFunction, Response } from "express";
import { SalaryAdvanceService } from "../services/salaryAdvanceService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { createSalaryAdvanceSchema, reviewSalaryAdvanceSchema } from "../validations/salaryAdvanceValidation.js";

const service = new SalaryAdvanceService();

export const getEligibility = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Advance eligibility", await service.eligibility(req.user!.userId)); }
  catch (error) { next(error); }
};

export const createAdvance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSalaryAdvanceSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Advance requested", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getMyAdvances = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as never);
    sendSuccess(res, "Advances retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAdvances = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as never);
    sendSuccess(res, "Advances retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const reviewAdvance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewSalaryAdvanceSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.review(String(req.params.id), parsed.data, req.user!.userId);
    sendSuccess(res, parsed.data.decision === "approve" ? "Approved — sent to finance" : "Advance refused", record);
  } catch (error) { next(error); }
};

export const withdrawAdvance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Request withdrawn", await service.cancelMine(String(req.params.id), req.user!.userId)); }
  catch (error) { next(error); }
};
