import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { CandidateService } from "../services/candidateService.js";
import {
  createCandidateSchema, updateCandidateSchema, applySchema, moveStageSchema,
} from "../validations/candidateValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { putObject, attachmentKey } from "../services/uploadService.js";
import { extFromMime } from "../middleware/upload.js";
import { getOrgId } from "../utils/orgContext.js";

const service = new CandidateService();

export const createCandidate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createCandidateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const { record, reused } = await service.create(parsed.data, req.user!.userId);
    // Said plainly, so nobody wonders why editing a "new" candidate changed an
    // existing record — a repeat email is the same person.
    sendSuccess(res, reused ? "This email was already on file — the existing candidate was updated" : "Candidate added", record, reused ? 200 : 201);
  } catch (error) { next(error); }
};

export const getCandidates = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Candidates retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getCandidateById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Candidate retrieved", await service.getById(req.params.id)); }
  catch (error) { next(error); }
};

export const updateCandidate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateCandidateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Candidate updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteCandidate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Candidate deleted", await service.remove(req.params.id)); }
  catch (error) { next(error); }
};

/** Attach a CV. Same 10 MB path as every other document — a CV is a document. */
export const uploadResume = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) { sendError(res, "No file uploaded", 400); return; }
    const ext = extFromMime(req.file.mimetype);
    const key = attachmentKey(getOrgId(), req.params.id, "resumes", ext, Date.now());
    await putObject(key, req.file.buffer, req.file.mimetype);
    sendSuccess(res, "Resume attached", await service.setResume(req.params.id, key, req.file.originalname));
  } catch (error) { next(error); }
};

// ── Applications ─────────────────────────────────────────────────────────────

export const applyCandidate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Candidate added to the pipeline", await service.apply(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getPipeline = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Pipeline", await service.pipeline(req.params.id)); }
  catch (error) { next(error); }
};

export const getApplications = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listApplications(req.query as Record<string, string>);
    sendSuccess(res, "Applications retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const moveApplication = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = moveStageSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Application updated", await service.moveStage(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const deleteApplication = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Application removed", await service.removeApplication(req.params.id)); }
  catch (error) { next(error); }
};
