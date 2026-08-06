import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ResignationService } from "../services/resignationService.js";
import { SettlementService } from "../services/settlementService.js";
import { runResignationRelieve } from "../jobs/resignationJob.js";
import {
  createResignationSchema, reviewResignationSchema, updateResignationSchema, exitDetailsSchema,
  settlementInputSchema, clearanceSchema, clearanceItemUpdateSchema, exitInterviewSchema,
} from "../validations/resignationValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ResignationService();
const settlementService = new SettlementService();

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

// ── Full & final settlement ──
export const previewSettlement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = settlementInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Settlement computed", await settlementService.preview(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const saveSettlement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = settlementInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Settlement saved", await settlementService.save(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const startClearance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Clearance checklist started", await service.startClearance(req.params.id));
  } catch (error) { next(error); }
};

export const setClearance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = clearanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Clearance checklist updated", await service.setClearance(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const updateClearanceItem = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = clearanceItemUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.updateClearanceItem(req.params.id, req.params.itemId, parsed.data, req.user!.userId);
    sendSuccess(res, "Clearance item updated", record);
  } catch (error) { next(error); }
};

export const saveExitInterview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = exitInterviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.saveExitInterview(req.params.id, parsed.data, req.user!.userId);
    sendSuccess(res, "Exit interview saved", record);
  } catch (error) { next(error); }
};

export const finaliseSettlement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Settlement finalised", await settlementService.settle(req.params.id));
  } catch (error) { next(error); }
};
