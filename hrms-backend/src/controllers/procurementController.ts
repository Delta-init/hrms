import type { NextFunction, Response } from "express";
import { ProcurementService } from "../services/procurementService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import {
  createProcurementSchema, updateProcurementSchema, reviewProcurementSchema, resubmitProcurementSchema,
} from "../validations/procurementValidation.js";

const service = new ProcurementService();

export const getProcurements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as never);
    sendSuccess(res, "Procurement retrieved", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getProcurementById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Procurement retrieved", await service.getById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
};

export const createProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Procurement created", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) {
    next(error);
  }
};

export const updateProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Procurement updated", await service.update(String(req.params.id), parsed.data));
  } catch (error) {
    next(error);
  }
};

export const reviewProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.review(String(req.params.id), parsed.data, req.user!.userId);
    sendSuccess(res, parsed.data.decision === "approve" ? "Sent to finance" : "Request rejected", record);
  } catch (error) {
    next(error);
  }
};

export const resubmitProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = resubmitProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Request resubmitted", await service.resubmit(String(req.params.id), parsed.data));
  } catch (error) {
    next(error);
  }
};

export const deleteProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Procurement deleted", await service.remove(String(req.params.id)));
  } catch (error) {
    next(error);
  }
};
