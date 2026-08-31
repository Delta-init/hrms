import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AssetService } from "../services/assetService.js";
import {
  createAssetSchema, updateAssetSchema, issueAssetSchema, returnAssetSchema,
} from "../validations/assetValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new AssetService();

export const createAsset = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createAssetSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Asset created", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getMyAssets = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your assets retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAssets = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Assets retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAssetFacets = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Asset facets retrieved", await service.facets());
  } catch (error) { next(error); }
};

export const getAssetById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Asset retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateAsset = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateAssetSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Asset updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteAsset = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Asset deleted", await service.remove(req.params.id));
  } catch (error) { next(error); }
};

export const issueAsset = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = issueAssetSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Asset issued", await service.issue(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const returnAsset = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = returnAssetSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Asset returned", await service.returnAsset(req.params.id, parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const markAssetAvailable = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Asset marked available", await service.markAvailable(req.params.id, req.user!.userId));
  } catch (error) { next(error); }
};

export const retireAsset = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Asset retired", await service.retire(req.params.id, req.user!.userId));
  } catch (error) { next(error); }
};
