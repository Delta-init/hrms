import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { RegularizationService } from "../services/regularizationService.js";
import { createRegularizationSchema, updateRegularizationSchema } from "../validations/regularizationValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new RegularizationService();

export const createRegularization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createRegularizationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Regularization request created", record, 201);
  } catch (error) { next(error); }
};

export const getRegularizations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Regularizations retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getMyRegularizations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your regularizations retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getRegularizationById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Regularization retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateRegularization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateRegularizationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.update(req.params.id, parsed.data, req.user!.userId);
    sendSuccess(res, "Regularization updated successfully", record);
  } catch (error) { next(error); }
};

export const deleteRegularization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};
