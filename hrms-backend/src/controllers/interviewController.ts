import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { InterviewService } from "../services/interviewService.js";
import { JobRequisitionService } from "../services/jobRequisitionService.js";
import {
  scheduleInterviewSchema, updateInterviewSchema, feedbackSchema, conflictQuerySchema, sheetSchema,
} from "../validations/interviewValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { hasPermission } from "../middleware/permissions.js";

const service = new InterviewService();
const requisitions = new JobRequisitionService();

export const scheduleInterview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = scheduleInterviewSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Interview scheduled", await service.schedule(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getInterviews = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Interviews retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getInterviewById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Interview retrieved", await service.getById(req.params.id)); }
  catch (error) { next(error); }
};

export const updateInterview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateInterviewSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Interview updated", await service.update(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const cancelInterview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Interview cancelled", await service.cancel(req.params.id)); }
  catch (error) { next(error); }
};

export const deleteInterview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Interview deleted", await service.remove(req.params.id)); }
  catch (error) { next(error); }
};

/** Who on the panel is already booked. Advisory — the form warns, not refuses. */
export const getConflicts = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = conflictQuerySchema.safeParse(req.query);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const { panel, scheduledAt, durationMinutes, exclude } = parsed.data;
    sendSuccess(res, "Conflicts", await service.conflicts(panel, scheduledAt, durationMinutes, exclude));
  } catch (error) { next(error); }
};

export const submitFeedback = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Feedback recorded", await service.submitFeedback(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const deleteFeedback = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Feedback removed", await service.removeFeedback(req.params.id, req.user!.userId)); }
  catch (error) { next(error); }
};

// ── The panellist's sheet ────────────────────────────────────────────────────
// Open to anybody signed in; the service admits only the interview's panel.

export const getMyInterviews = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Your interviews", await service.myInterviews(req.user!.userId)); }
  catch (error) { next(error); }
};

export const getMySheet = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Interview sheet", await service.sheetFor(req.params.id, req.user!.userId)); }
  catch (error) { next(error); }
};

export const saveMySheet = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = sheetSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const sheet = await service.saveSheet(req.params.id, req.user!.userId, parsed.data);
    sendSuccess(res, parsed.data.submit ? "Interview sheet submitted" : "Draft saved", sheet);
  } catch (error) { next(error); }
};

/**
 * Every submitted sheet for a role, best-marked candidate first. Whoever may
 * read the role may read these — a department head only for their own.
 */
export const getInterviewResults = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const head = hasPermission(req.user?.role, "hiring", "view") ? undefined : req.user!.userId;
    await requisitions.getById(req.params.id, head, req.user!.userId);
    const application = typeof req.query.application === "string" ? req.query.application : undefined;
    sendSuccess(res, "Interview results", await service.resultsFor(req.params.id, application));
  } catch (error) { next(error); }
};
