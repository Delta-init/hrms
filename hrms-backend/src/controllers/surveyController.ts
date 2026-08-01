import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { SurveyService } from "../services/surveyService.js";
import {
  createSurveySchema, updateSurveySchema, setSurveyStatusSchema, submitSurveyResponseSchema,
} from "../validations/surveyValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new SurveyService();

export const createSurvey = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSurveySchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, "Survey created", record, 201);
  } catch (error) { next(error); }
};

export const getSurveys = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Surveys retrieved successfully", await service.list());
  } catch (error) { next(error); }
};

export const getSurveyById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Survey retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateSurvey = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateSurveySchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Survey updated successfully", record);
  } catch (error) { next(error); }
};

export const setSurveyStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setSurveyStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.setStatus(req.params.id, parsed.data);
    sendSuccess(res, "Survey status updated", record);
  } catch (error) { next(error); }
};

export const deleteSurvey = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};

export const getSurveyResults = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Survey results retrieved successfully", await service.getResults(req.params.id));
  } catch (error) { next(error); }
};

// ── Self-service ────────────────────────────────────────────────────────────
export const getMySurveys = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Surveys retrieved successfully", await service.listMine(req.user!.userId));
  } catch (error) { next(error); }
};

export const submitMySurveyResponse = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = submitSurveyResponseSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.submitResponse(req.user!.userId, req.params.id, parsed.data);
    sendSuccess(res, "Response submitted — thank you!", record, 201);
  } catch (error) { next(error); }
};
