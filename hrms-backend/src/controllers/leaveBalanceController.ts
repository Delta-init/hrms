import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LeaveBalanceService } from "../services/leaveBalanceService.js";
import { createLeavePolicySchema, updateLeavePolicySchema } from "../validations/leavePolicyValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { z } from "zod";
import { balancesForEmployee, adjustBalance } from "../services/leaveBalanceEditService.js";

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

// ── Editing someone's balance (2026-11-26) ───────────────────────────────────

const adjustSchema = z.object({
  type: z.string().trim().min(1).max(40),
  year: z.number().int().min(2000).max(2200),
  mode: z.enum(["set", "add"]),
  days: z.number().min(-366).max(366),
  reason: z.string().trim().min(3, "Say why the balance is changing").max(300),
});

export const getEmployeeLeaveBalances = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    sendSuccess(res, "Leave balances retrieved", await balancesForEmployee(req.params.employeeId, year));
  } catch (error) { next(error); }
};

export const adjustEmployeeLeaveBalance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors as never); return; }
    const role = req.user!.role;
    const out = await adjustBalance(req.params.employeeId, parsed.data, {
      userId: req.user!.userId,
      isSuperAdmin: !!role?.isSystemRole && role.roleName === "Super Admin",
    });
    sendSuccess(res, `Balance changed: ${out.from} → ${out.to} days`, out);
  } catch (error) { next(error); }
};
