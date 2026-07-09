import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { CardService } from "../services/cardService.js";
import { createCardSchema, updateCardSchema } from "../validations/cardValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new CardService();

export const createCard = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createCardSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Card created successfully", record, 201);
  } catch (error) { next(error); }
};

export const getCards = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Cards retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getCardById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Card retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateCard = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateCardSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Card updated successfully", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteCard = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Card deleted successfully", null);
  } catch (error) { next(error); }
};
