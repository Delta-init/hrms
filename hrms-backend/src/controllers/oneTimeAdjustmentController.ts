import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { OneTimeAdjustmentService } from "../services/oneTimeAdjustmentService.js";
import { createOneTimeSchema, updateOneTimeSchema } from "../validations/oneTimeAdjustmentValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new OneTimeAdjustmentService();

export const createAdjustment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createOneTimeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Adjustment added", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getAdjustments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Adjustments retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAdjustmentById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Adjustment retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateAdjustment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateOneTimeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Adjustment updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteAdjustment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Adjustment removed", null);
  } catch (error) { next(error); }
};
