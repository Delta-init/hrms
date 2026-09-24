import type { NextFunction, Response } from "express";
import { DeductionRemovalService } from "../services/deductionRemovalService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { createDeductionRemovalSchema, reviewDeductionRemovalSchema } from "../validations/deductionRemovalValidation.js";

const service = new DeductionRemovalService();

export const getEligible = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) { sendError(res, "A month (YYYY-MM) is required", 400); return; }
    sendSuccess(res, "Eligible deductions retrieved", await service.eligible(req.user!.userId, month));
  } catch (error) { next(error); }
};

export const createRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createDeductionRemovalSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, "Request raised", record, 201);
  } catch (error) { next(error); }
};

export const getMyRequests = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as never);
    sendSuccess(res, "Requests retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getRequests = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as never);
    sendSuccess(res, "Requests retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const reviewRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewDeductionRemovalSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.review(String(req.params.id), parsed.data, req.user!.userId);
    sendSuccess(res, `Request ${parsed.data.status}`, record);
  } catch (error) { next(error); }
};

export const withdrawRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Request withdrawn", await service.cancelMine(String(req.params.id), req.user!.userId));
  } catch (error) { next(error); }
};
