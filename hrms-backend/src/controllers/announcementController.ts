import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AnnouncementService } from "../services/announcementService.js";
import { createAnnouncementSchema, updateAnnouncementSchema } from "../validations/announcementValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new AnnouncementService();

export const createAnnouncement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, "Announcement posted", record, 201);
  } catch (error) { next(error); }
};

export const getAnnouncements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Announcements retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAnnouncementById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Announcement retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateAnnouncement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Announcement updated successfully", record);
  } catch (error) { next(error); }
};

export const deleteAnnouncement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};
