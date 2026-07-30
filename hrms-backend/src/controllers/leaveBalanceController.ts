import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LeaveBalanceService } from "../services/leaveBalanceService.js";
import { createLeavePolicySchema, updateLeavePolicySchema } from "../validations/leavePolicyValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new LeaveBalanceService();

export const createLeavePolicy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createLeavePolicySchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Leave policy created", await service.createPolicy(parsed.data), 201);
  } catch (error) { next(error); }
};

export const getLeavePolicies = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Leave policies retrieved", await service.listPolicies());
  } catch (error) { next(error); }
};

export const updateLeavePolicy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateLeavePolicySchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Leave policy updated", await service.updatePolicy(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteLeavePolicy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Leave policy deleted", await service.removePolicy(req.params.id));
  } catch (error) { next(error); }
};

/** Self-service: the caller's own balances. */
export const getMyLeaveBalances = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    sendSuccess(res, "Leave balances retrieved", await service.computeBalances(req.user!.userId, year));
  } catch (error) { next(error); }
};

/** Admin: any employee's balances, by their login user id. */
export const getLeaveBalancesFor = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    sendSuccess(res, "Leave balances retrieved", await service.computeBalances(req.params.userId, year));
  } catch (error) { next(error); }
};
