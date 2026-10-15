import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { OfferService } from "../services/offerService.js";
import { offerTemplateSchema, updateOfferTemplateSchema, offerPreviewSchema, sendOfferSchema } from "../validations/offerValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new OfferService();

export const getOfferTemplates = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Offer email templates", await service.listTemplates()); } catch (error) { next(error); }
};

export const getOfferLetterTemplates = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Offer letter templates", await service.letterTemplates()); } catch (error) { next(error); }
};

export const createOfferTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = offerTemplateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Template created", await service.createTemplate(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const updateOfferTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateOfferTemplateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Template updated", await service.updateTemplate(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteOfferTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, (await service.removeTemplate(req.params.id)).message); } catch (error) { next(error); }
};

export const getOfferInboxStatus = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Offer inbox", await service.inboxStatus()); } catch (error) { next(error); }
};

export const previewOffer = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = offerPreviewSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Offer preview", await service.preview(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const sendOffer = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = sendOfferSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.send(req.params.id, parsed.data, req.user!.userId);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};

export const getOfferThread = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Offer emails", await service.thread(req.params.id)); } catch (error) { next(error); }
};

export const uploadSignedOffer = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) { sendError(res, "No file uploaded", 400); return; }
    sendSuccess(res, "Signed offer saved", await service.uploadSigned(req.params.id, req.file, req.user!.userId));
  } catch (error) { next(error); }
};
