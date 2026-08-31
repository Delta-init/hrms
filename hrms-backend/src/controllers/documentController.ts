import { documentsOverview, ignoreDocuments, unignoreDocuments, type DocumentRef } from "../services/documentOverviewService.js";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import {
  listMyDocuments,
  uploadMyDocument,
  deleteMyDocument,
  listEmployeeDocuments,
  uploadEmployeeDocument,
  deleteEmployeeDocument,
  listOtherDocuments,
  addOtherDocument,
  updateOtherDocument,
  deleteOtherDocument,
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

/*
 * Free-form documents and credentials. These arrive as multipart so a file can
 * ride along with the details in one request; the fields land in req.body as
 * strings and the service parses the dates.
 */

export const listOtherDocs = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    sendSuccess(res, "Documents retrieved", await listOtherDocuments(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const addOtherDoc = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await addOtherDocument(req.params.id, req.body ?? {}, req.file);
    sendSuccess(res, "Document added", data, 201);
  } catch (error) {
    next(error);
  }
};

export const updateOtherDoc = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await updateOtherDocument(req.params.id, req.params.recordId, req.body ?? {}, req.file);
    sendSuccess(res, "Document updated", data);
  } catch (error) {
    next(error);
  }
};

export const deleteOtherDoc = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteOtherDocument(req.params.id, req.params.recordId);
    sendSuccess(res, "Document removed", data);
  } catch (error) {
    next(error);
  }
};

/** Every document the organization should hold, present or missing. */
export const getDocumentsOverview = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await documentsOverview(req.query as Record<string, string>);
    sendSuccess(res, "Documents overview", data);
  } catch (error) { next(error); }
};

/**
 * Read a bulk selection off the request.
 *
 * The table sends whole rows; only the two fields that identify one are kept,
 * and anything missing either is dropped rather than written as a half-formed
 * dismissal that would never match a row again.
 */
function refsFrom(body: unknown): DocumentRef[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({ employee: String((i as DocumentRef)?.employee ?? ""), slot: String((i as DocumentRef)?.slot ?? "") }))
    .filter((i) => i.employee && i.slot)
    .slice(0, 500);
}

/** Stop counting the selected documents as a problem. */
export const ignoreDocumentRows = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refs = refsFrom(req.body);
    if (!refs.length) { sendError(res, "Select at least one document", 400); return; }
    const reason = String((req.body as { reason?: string })?.reason ?? "");
    sendSuccess(res, "Documents ignored", await ignoreDocuments(refs, req.user!.userId, reason));
  } catch (error) { next(error); }
};

/** Put the selected documents back in the counts. */
export const unignoreDocumentRows = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refs = refsFrom(req.body);
    if (!refs.length) { sendError(res, "Select at least one document", 400); return; }
    sendSuccess(res, "Documents restored", await unignoreDocuments(refs));
  } catch (error) { next(error); }
};
