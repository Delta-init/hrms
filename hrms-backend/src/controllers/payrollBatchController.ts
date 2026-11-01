import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { payrollBatchService as service } from "../services/payrollBatchService.js";
import { sendSuccess, sendError } from "../utils/response.js";

const MONTH = /^\d{4}-\d{2}$/;

function month(req: AuthenticatedRequest, res: Response): string | null {
  const value = String(req.params.month ?? "").trim();
  if (!MONTH.test(value)) {
    sendError(res, "Month must be in YYYY-MM format", 400);
    return null;
  }
  return value;
}

export const getPayrollBatch = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const m = month(req, res);
    if (!m) return;
    sendSuccess(res, "Payroll batch retrieved", await service.describe(m));
  } catch (error) { next(error); }
};

export const getPayrollBatches = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 12));
    sendSuccess(res, "Payroll batches retrieved", await service.list(limit));
  } catch (error) { next(error); }
};

export const getPreflight = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const m = month(req, res);
    if (!m) return;
    sendSuccess(res, "Preflight complete", await service.preflight(m));
  } catch (error) { next(error); }
};

export const submitPayroll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const m = month(req, res);
    if (!m) return;
    const result = await service.submit(m, req.user!.userId);
    sendSuccess(res, result.message, result.batch);
  } catch (error) { next(error); }
};

export const recallPayroll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const m = month(req, res);
    if (!m) return;
    const result = await service.recall(m, req.user!.userId);
    sendSuccess(res, result.message, result.batch);
  } catch (error) { next(error); }
};
