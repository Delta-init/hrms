import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { JobRequisitionService } from "../services/jobRequisitionService.js";
import {
  createRequisitionSchema, updateRequisitionSchema, reviewRequisitionSchema,
} from "../validations/jobRequisitionValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { putObject, attachmentKey } from "../services/uploadService.js";
import { extFromMime } from "../middleware/upload.js";
import { getOrgId } from "../utils/orgContext.js";

const service = new JobRequisitionService();

export const createRequisition = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createRequisitionSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, "Requisition raised", record, 201);
  } catch (error) { next(error); }
};

export const getRequisitions = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Requisitions retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getRequisitionById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Requisition retrieved", await service.getById(req.params.id)); }
  catch (error) { next(error); }
};

export const updateRequisition = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateRequisitionSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Requisition updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const reviewRequisition = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewRequisitionSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.review(req.params.id, parsed.data, req.user!.userId, req.user!.role as never);
    sendSuccess(res, `Requisition ${parsed.data.status}`, record);
  } catch (error) { next(error); }
};

export const deleteRequisition = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Requisition deleted", await service.remove(req.params.id)); }
  catch (error) { next(error); }
};

/** Attach a JD. Same 10 MB document path as a candidate's CV. */
export const uploadJd = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) { sendError(res, "No file uploaded", 400); return; }
    const ext = extFromMime(req.file.mimetype);
    const key = attachmentKey(getOrgId(), req.params.id, "jds", ext, Date.now());
    await putObject(key, req.file.buffer, req.file.mimetype);
    sendSuccess(res, "JD attached", await service.setJd(req.params.id, key, req.file.originalname));
  } catch (error) { next(error); }
};

/** Whether a hiring chain is configured — the page warns when it is not. */
export const getHiringWorkflowState = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Hiring workflow", await service.workflowState()); }
  catch (error) { next(error); }
};
