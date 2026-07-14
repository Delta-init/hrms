import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ResignationService } from "../services/resignationService.js";
import { runResignationRelieve } from "../jobs/resignationJob.js";
import { createResignationSchema, reviewResignationSchema, updateResignationSchema, exitDetailsSchema } from "../validations/resignationValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ResignationService();

export const createResignation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createResignationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Resignation recorded", await service.create(parsed.data), 201);
  } catch (error) { next(error); }
};

export const getResignations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Resignations retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getResignationById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Resignation retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateResignation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateResignationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Resignation updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const reviewResignation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewResignationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Resignation reviewed", await service.review(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const withdrawResignation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Resignation withdrawn", await service.withdraw(req.params.id));
  } catch (error) { next(error); }
};

export const relieveResignation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Employee relieved", await service.relieve(req.params.id, req.user!.userId));
  } catch (error) { next(error); }
};

export const setExitDetails = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = exitDetailsSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Exit details saved", await service.setExitDetails(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteResignation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Resignation deleted", null);
  } catch (error) { next(error); }
};

/** Manually run the auto-relieve pass (testing / on-demand). */
export const runRelieveDue = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const relieved = await runResignationRelieve();
    sendSuccess(res, "Relieve pass executed", { relieved });
  } catch (error) { next(error); }
};
