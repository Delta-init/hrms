import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { OnboardingService } from "../services/onboardingService.js";
import {
  createTemplateSchema, updateTemplateSchema, createChecklistSchema, updateTaskStatusSchema,
} from "../validations/onboardingValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new OnboardingService();

// ── Templates ────────────────────────────────────────────────────────────
export const createTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Template created", await service.createTemplate(parsed.data), 201);
  } catch (error) { next(error); }
};

export const getTemplates = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Templates retrieved", await service.listTemplates()); } catch (error) { next(error); }
};

export const getTemplateById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Template retrieved", await service.getTemplateById(req.params.id)); } catch (error) { next(error); }
};

export const updateTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Template updated", await service.updateTemplate(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Template deleted", await service.removeTemplate(req.params.id)); } catch (error) { next(error); }
};

// ── Checklists ───────────────────────────────────────────────────────────
export const createChecklist = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createChecklistSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Checklist created", await service.createChecklist(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getChecklists = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Checklists retrieved", await service.listChecklists(req.query as Record<string, string>)); } catch (error) { next(error); }
};

export const getChecklistById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Checklist retrieved", await service.getChecklistById(req.params.id)); } catch (error) { next(error); }
};

export const deleteChecklist = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Checklist deleted", await service.removeChecklist(req.params.id)); } catch (error) { next(error); }
};

export const setTaskStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Task updated", await service.setTaskStatus(req.params.id, req.params.taskId, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

// ── Self-service ─────────────────────────────────────────────────────────
export const getMyChecklist = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Checklist retrieved", await service.getMyChecklist(req.user!.userId)); } catch (error) { next(error); }
};

export const setMyTaskStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Task updated", await service.setMyTaskStatus(req.user!.userId, req.params.taskId, parsed.data));
  } catch (error) { next(error); }
};
