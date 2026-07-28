import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { OvertimeService } from "../services/overtimeService.js";
import { createOvertimeSchema, updateOvertimeSchema } from "../validations/overtimeValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new OvertimeService();

export const createOvertime = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createOvertimeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Overtime added", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getOvertime = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Overtime retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getOvertimeById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Overtime retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateOvertime = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateOvertimeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Overtime updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteOvertime = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Overtime removed", null);
  } catch (error) { next(error); }
};
