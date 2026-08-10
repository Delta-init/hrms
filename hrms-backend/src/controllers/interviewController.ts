import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { InterviewService } from "../services/interviewService.js";
import {
  scheduleInterviewSchema, updateInterviewSchema, feedbackSchema, conflictQuerySchema,
} from "../validations/interviewValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new InterviewService();

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
    sendSuccess(res, "Interview updated", await service.update(req.params.id, parsed.data));
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
