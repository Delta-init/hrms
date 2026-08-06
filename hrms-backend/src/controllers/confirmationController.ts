import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ConfirmationService } from "../services/confirmationService.js";
import { initiateConfirmationSchema, reviewConfirmationSchema } from "../validations/confirmationValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ConfirmationService();

export const getDueConfirmations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const within = parseInt(String(req.query.withinDays ?? "30"), 10);
    const days = Number.isFinite(within) && within > 0 ? Math.min(within, 365) : 30;
    sendSuccess(res, "Confirmations due retrieved", await service.due(days));
  } catch (error) { next(error); }
};

export const getConfirmations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Confirmations retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getConfirmationById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Confirmation retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const initiateConfirmation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = initiateConfirmationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.initiate(parsed.data, req.user!.userId);
    sendSuccess(res, parsed.data.useWorkflow ? "Confirmation sent for approval" : "Employee confirmed", record, 201);
  } catch (error) { next(error); }
};

export const reviewConfirmation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewConfirmationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const role = req.user!.role!;
    const record = await service.review(req.params.id, parsed.data, req.user!.userId, {
      _id: String(role._id), roleName: role.roleName, isSystemRole: role.isSystemRole,
    });
    sendSuccess(res, "Confirmation reviewed", record);
  } catch (error) { next(error); }
};

export const withdrawConfirmation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Confirmation withdrawn", await service.withdraw(req.params.id));
  } catch (error) { next(error); }
};
