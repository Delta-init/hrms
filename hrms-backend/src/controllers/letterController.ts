import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LetterService } from "../services/letterService.js";
import {
  createLetterTemplateSchema, updateLetterTemplateSchema, generateLetterSchema, updateGeneratedLetterSchema,
} from "../validations/letterValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new LetterService();

// ── Templates ────────────────────────────────────────────────────────────
export const createLetterTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createLetterTemplateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Template created", await service.createTemplate(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getLetterTemplates = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Templates retrieved", await service.listTemplates()); } catch (error) { next(error); }
};

export const getLetterTemplateById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Template retrieved", await service.getTemplateById(req.params.id)); } catch (error) { next(error); }
};

export const updateLetterTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateLetterTemplateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Template updated", await service.updateTemplate(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteLetterTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Template deleted", await service.removeTemplate(req.params.id)); } catch (error) { next(error); }
};

// ── Generated letters ───────────────────────────────────────────────────
export const generateLetter = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = generateLetterSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Letter generated", await service.generateLetter(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getGeneratedLetters = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Letters retrieved", await service.listGeneratedLetters(req.query as Record<string, string>)); } catch (error) { next(error); }
};

export const getGeneratedLetterById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Letter retrieved", await service.getGeneratedLetterById(req.params.id)); } catch (error) { next(error); }
};

export const updateGeneratedLetter = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateGeneratedLetterSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Letter updated", await service.updateGeneratedLetter(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteGeneratedLetter = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Letter deleted", await service.removeGeneratedLetter(req.params.id)); } catch (error) { next(error); }
};
