import type { NextFunction, Response } from "express";
import { OfficeKeepingService } from "../services/officeKeepingService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { createOfficeKeepingSchema, updateStatusSchema } from "../validations/officeKeepingValidation.js";

const service = new OfficeKeepingService();

export const createRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Multipart, so the text fields arrive as strings beside the file.
    const parsed = createOfficeKeepingSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.create(parsed.data, req.user!.userId, req.file);
    sendSuccess(res, "Request raised", record, 201);
  } catch (error) { next(error); }
};

export const getMyRequests = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as never);
    sendSuccess(res, "Requests retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getRequests = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as never);
    sendSuccess(res, "Requests retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const setStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Status updated", await service.updateStatus(String(req.params.id), parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const withdrawRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Request withdrawn", await service.cancelMine(String(req.params.id), req.user!.userId));
  } catch (error) { next(error); }
};
