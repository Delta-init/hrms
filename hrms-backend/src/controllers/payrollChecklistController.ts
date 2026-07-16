import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { PayrollChecklistService } from "../services/payrollChecklistService.js";
import { createChecklistItemSchema, updateChecklistItemSchema } from "../validations/payrollChecklistValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new PayrollChecklistService();

export const getChecklist = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Payroll checklist", await service.list());
  } catch (error) { next(error); }
};

export const createChecklistItem = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Checklist item added", await service.create(parsed.data), 201);
  } catch (error) { next(error); }
};

export const updateChecklistItem = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Checklist item updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteChecklistItem = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Checklist item removed", null);
  } catch (error) { next(error); }
};
