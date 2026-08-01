import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ReimbursementService } from "../services/reimbursementService.js";
import {
  createReimbursementSchema, updateReimbursementSchema, reviewReimbursementSchema,
} from "../validations/reimbursementValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ReimbursementService();

const canApprove = (req: AuthenticatedRequest) =>
  !!req.user?.role?.permissions?.reimbursements?.approve || req.user?.role?.roleName === "Super Admin";

export const createReimbursement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createReimbursementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, {
      createdBy: req.user!.userId,
      subjectUserId: req.user!.userId,
      canApproveOthers: canApprove(req),
    });
    sendSuccess(res, "Reimbursement claim submitted", record, 201);
  } catch (error) { next(error); }
};

export const getReimbursements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Reimbursements retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getMyReimbursements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your reimbursements retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getReimbursementById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Reimbursement retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateReimbursement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateReimbursementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Reimbursement updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const reviewReimbursement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewReimbursementSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const role = req.user!.role!;
    const record = await service.review(req.params.id, parsed.data, req.user!.userId, { _id: String(role._id), roleName: role.roleName, isSystemRole: role.isSystemRole });
    sendSuccess(res, "Reimbursement reviewed", record);
  } catch (error) { next(error); }
};

export const deleteReimbursement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Reimbursement deleted", null);
  } catch (error) { next(error); }
};
