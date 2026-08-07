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

/**
 * Say what the roster sync did.
 *
 * "Cycle status updated" gave no clue whether anyone had actually been given an
 * appraisal, so activating a cycle for an organization with no eligible
 * employees looked exactly like a working feature until someone went looking
 * for the appraisals that were never created.
 */
function syncSummary(counts: { generated?: number; skipped?: number }): string {
  const generated = counts.generated ?? 0;
  const skipped = counts.skipped ?? 0;
  const parts = [`${generated} appraisal${generated === 1 ? "" : "s"} generated`];
  if (skipped) parts.push(`${skipped} employee${skipped === 1 ? "" : "s"} skipped — no login account`);
  else if (!generated) parts.push("no eligible employees found");
  return parts.join(", ");
}

export const setCycleStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setCycleStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.setCycleStatus(req.params.id, parsed.data);
    const message =
      parsed.data.status === "active" ? `Cycle activated — ${syncSummary(result)}` : "Cycle status updated";
    sendSuccess(res, message, result);
  } catch (error) { next(error); }
};

export const syncCycle = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.syncCycle(req.params.id);
    sendSuccess(res, `Roster synced — ${syncSummary(result)}`, result);
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
