import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { PerformanceService } from "../services/performanceService.js";
import {
  createCycleSchema, setCycleStatusSchema, setGoalsSchema, submitSelfReviewSchema, reviewAppraisalSchema,
} from "../validations/performanceValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new PerformanceService();

// ── Cycles ───────────────────────────────────────────────────────────────────
export const createCycle = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createCycleSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Cycle created", await service.createCycle(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getCycles = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Cycles retrieved", await service.listCycles()); }
  catch (error) { next(error); }
};

export const setCycleStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setCycleStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Cycle status updated", await service.setCycleStatus(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteCycle = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.removeCycle(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};

// ── Appraisals (admin/manager) ──────────────────────────────────────────────
export const getAppraisals = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Appraisals retrieved", await service.listAppraisals(req.query as Record<string, string>)); }
  catch (error) { next(error); }
};

export const getAppraisalById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Appraisal retrieved", await service.getAppraisalById(req.params.id)); }
  catch (error) { next(error); }
};

export const reviewAppraisal = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewAppraisalSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Appraisal reviewed", await service.review(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

// ── Self-service ─────────────────────────────────────────────────────────────
export const getMyAppraisals = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Your appraisals retrieved", await service.listMine(req.user!.userId)); }
  catch (error) { next(error); }
};

export const setMyGoals = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setGoalsSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Goals saved", await service.setGoals(req.user!.userId, req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const submitMySelfReview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = submitSelfReviewSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Self-review submitted", await service.submitSelfReview(req.user!.userId, req.params.id, parsed.data));
  } catch (error) { next(error); }
};
