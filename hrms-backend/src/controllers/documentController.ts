import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import {
  listMyDocuments,
  uploadMyDocument,
  deleteMyDocument,
} from "../services/documentService.js";
import { sendSuccess, sendError } from "../utils/response.js";

export const listDocuments = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await listMyDocuments(req.user!.userId);
    sendSuccess(res, "Documents retrieved", data);
  } catch (error) {
    next(error);
  }
};

export const uploadDocument = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const type = String(req.body?.type ?? "").trim();
    if (!type) {
      sendError(res, "Document type is required", 400);
      return;
    }
    if (!req.file) {
      sendError(res, "No file uploaded", 400);
      return;
    }
    const data = await uploadMyDocument(req.user!.userId, type, req.file);
    sendSuccess(res, "Document uploaded", data);
  } catch (error) {
    next(error);
  }
};

export const deleteDocument = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteMyDocument(req.user!.userId, req.params.type);
    sendSuccess(res, "Document removed", data);
  } catch (error) {
    next(error);
  }
};
