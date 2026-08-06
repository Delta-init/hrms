import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import {
  listMyDocuments,
  uploadMyDocument,
  deleteMyDocument,
  listEmployeeDocuments,
  uploadEmployeeDocument,
  deleteEmployeeDocument,
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

/*
 * Administrator handlers — same three operations for an employee named in the
 * URL. Permission is enforced on the route, not here.
 */

export const listDocumentsForEmployee = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    sendSuccess(res, "Documents retrieved", await listEmployeeDocuments(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const uploadDocumentForEmployee = async (
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
    const data = await uploadEmployeeDocument(req.params.id, type, req.file);
    sendSuccess(res, "Document uploaded", data);
  } catch (error) {
    next(error);
  }
};

export const deleteDocumentForEmployee = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteEmployeeDocument(req.params.id, req.params.type);
    sendSuccess(res, "Document removed", data);
  } catch (error) {
    next(error);
  }
};
