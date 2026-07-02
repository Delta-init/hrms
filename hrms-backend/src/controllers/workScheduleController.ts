import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { WorkScheduleService } from "../services/workScheduleService.js";
import { createWorkScheduleSchema, updateWorkScheduleSchema } from "../validations/workScheduleValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new WorkScheduleService();

export const createWorkSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createWorkScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Work schedule created successfully", record, 201);
  } catch (error) {
    next(error);
  }
};

export const getWorkSchedules = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Work schedules retrieved successfully", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getAllWorkSchedulesSimple = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const records = await service.listSimple();
    sendSuccess(res, "Work schedules retrieved successfully", records);
  } catch (error) {
    next(error);
  }
};

export const getWorkScheduleById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.getById(req.params.id);
    sendSuccess(res, "Work schedule retrieved successfully", record);
  } catch (error) {
    next(error);
  }
};

export const updateWorkSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateWorkScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Work schedule updated successfully", record);
  } catch (error) {
    next(error);
  }
};

export const deleteWorkSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};
