import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { RegularizationService } from "../services/regularizationService.js";
import { createRegularizationSchema, updateRegularizationSchema } from "../validations/regularizationValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new RegularizationService();

export const createRegularization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Self-service: approvers may file for anyone; everyone else only for
    // themselves. Default the subject to the caller.
    const canApproveOthers = !!req.user?.role?.permissions?.regularization?.approve
      || req.user?.role?.roleName === "Super Admin";
    const body = { ...req.body };
    if (!canApproveOthers || !body.user) body.user = req.user?.userId;
    const parsed = createRegularizationSchema.safeParse(body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Regularization request created", record, 201);
  } catch (error) { next(error); }
};

export const getRegularizations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Same reasoning as leave.view: `regularization.view` is also granted to plain
    // Employees for self-service nav visibility, so it can't be trusted to gate the
    // org-wide list. Only reviewers (regularization.edit) or Super Admin get the
    // unscoped view; everyone else is pinned to their own requests.
    const canViewAll = !!req.user?.role?.permissions?.regularization?.edit || req.user?.role?.roleName === "Super Admin";
    const query = { ...(req.query as Record<string, string>) };
    if (!canViewAll) query.user = req.user!.userId;
    const { records, pagination } = await service.list(query);
    sendSuccess(res, "Regularizations retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getMyRegularizations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your regularizations retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getRegularizationById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Regularization retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateRegularization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateRegularizationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const role = req.user!.role!;
    const record = await service.update(req.params.id, parsed.data, req.user!.userId, { _id: String(role._id), roleName: role.roleName, isSystemRole: role.isSystemRole });
    sendSuccess(res, "Regularization updated successfully", record);
  } catch (error) { next(error); }
};

export const deleteRegularization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};
