import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LeaveService } from "../services/leaveService.js";
import { createLeaveSchema, updateLeaveSchema } from "../validations/leaveValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new LeaveService();

export const createLeave = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createLeaveSchema.safeParse(req.body);
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
    const { records, pagination } = await service.list(req.query as Record<string, string>);
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
    const record = await service.update(req.params.id, parsed.data, req.user!.userId);
    sendSuccess(res, "Leave request updated successfully", record);
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
