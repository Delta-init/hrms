import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { SalaryIncrementService } from "../services/salaryIncrementService.js";
import { createSalaryIncrementSchema, updateSalaryIncrementSchema } from "../validations/salaryIncrementValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new SalaryIncrementService();

export const createIncrement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSalaryIncrementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Salary increment recorded", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getIncrements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Salary increments retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getIncrementById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Salary increment retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateIncrement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateSalaryIncrementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Salary increment updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteIncrement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Salary increment deleted", null);
  } catch (error) { next(error); }
};
