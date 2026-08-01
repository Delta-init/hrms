import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { CompOffService } from "../services/compOffService.js";
import { grantCompOffSchema } from "../validations/compOffValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new CompOffService();

export const grantCompOff = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = grantCompOffSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Comp-off credited", await service.grant(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getCompOffCredits = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Credits retrieved", await service.list(req.query as Record<string, string>)); } catch (error) { next(error); }
};

export const revokeCompOffCredit = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Credit revoked", await service.revoke(req.params.id)); } catch (error) { next(error); }
};

export const getCompOffSuggestions = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 60;
    sendSuccess(res, "Suggestions retrieved", await service.suggestions(Number.isFinite(days) ? days : 60));
  } catch (error) { next(error); }
};

export const getMyCompOffBalance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Balance retrieved", await service.balanceFor(req.user!.userId)); } catch (error) { next(error); }
};

export const getCompOffBalanceFor = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Balance retrieved", await service.balanceFor(req.params.userId)); } catch (error) { next(error); }
};
