import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { OrganizationService } from "../services/organizationService.js";
import { createOrganizationSchema, updateOrganizationSchema } from "../validations/organizationValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new OrganizationService();

export const createOrganization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createOrganizationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Organization created", await service.create(parsed.data), 201);
  } catch (error) { next(error); }
};

export const getOrganizations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Organizations retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAllOrganizations = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Organizations retrieved", await service.listAll());
  } catch (error) { next(error); }
};

export const getOrganizationById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Organization retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateOrganization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateOrganizationSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Organization updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteOrganization = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Organization deleted", null);
  } catch (error) { next(error); }
};
