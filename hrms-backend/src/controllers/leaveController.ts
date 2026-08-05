import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LeaveService } from "../services/leaveService.js";
import { createLeaveSchema, updateLeaveSchema, reviewLeaveSchema } from "../validations/leaveValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new LeaveService();

export const createLeave = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Self-service: managers (leave.approve) may file for anyone; everyone else
    // can only file for themselves. Default the subject to the caller.
    const canApproveOthers = !!req.user?.role?.permissions?.leave?.approve
      || req.user?.role?.roleName === "Super Admin";
    const body = { ...req.body };
    if (!canApproveOthers || !body.user) body.user = req.user?.userId;
    const parsed = createLeaveSchema.safeParse(body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Leave request created successfully", record, 201);
  } catch (error) {
    next(error);
  }
};

export const getLeaves = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // The `leave.view` permission also drives self-service nav visibility, so it's
    // held by plain Employees too — without this, the org-wide list would leak
    // every employee's leave requests to them. Only approvers/Super Admin get
    // the unscoped view; everyone else is pinned to their own requests.
    const canViewAll = !!req.user?.role?.permissions?.leave?.approve || req.user?.role?.roleName === "Super Admin";
    const query = { ...(req.query as Record<string, string>) };
    if (!canViewAll) query.user = req.user!.userId;
    const { records, pagination } = await service.list(query);
    sendSuccess(res, "Leave requests retrieved successfully", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getMyLeaves = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your leave requests retrieved successfully", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getLeaveById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.getById(req.params.id);
    sendSuccess(res, "Leave request retrieved successfully", record);
  } catch (error) {
    next(error);
  }
};

export const updateLeave = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const role = req.user!.role!;
    const record = await service.update(req.params.id, parsed.data, req.user!.userId, { _id: String(role._id), roleName: role.roleName, isSystemRole: role.isSystemRole });
    sendSuccess(res, "Leave request updated successfully", record);
  } catch (error) {
    next(error);
  }
};

export const reviewLeave = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const role = req.user!.role!;
    const record = await service.update(req.params.id, parsed.data, req.user!.userId, { _id: String(role._id), roleName: role.roleName, isSystemRole: role.isSystemRole });
    sendSuccess(res, "Leave request reviewed", record);
  } catch (error) {
    next(error);
  }
};

export const deleteLeave = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};

/** Self-service — the requester withdraws their own still-pending request. */
export const withdrawLeave = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.withdraw(req.params.id, req.user!.userId);
    sendSuccess(res, "Leave request withdrawn", record);
  } catch (error) {
    next(error);
  }
};
