import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import {
  listCompanyDocuments,
  createCompanyDocument,
  updateCompanyDocument,
  deleteCompanyDocument,
} from "../services/companyDocumentService.js";
import { sendSuccess } from "../utils/response.js";

/*
 * Company documents — the licences and contracts the business itself holds.
 * These arrive as multipart so the scan rides along with the details in one
 * request; the fields land in req.body as strings and the service parses them.
 */

export const getCompanyDocuments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Company documents retrieved", await listCompanyDocuments(req.query as Record<string, string>));
  } catch (error) { next(error); }
};

export const addCompanyDocument = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await createCompanyDocument(req.body ?? {}, req.user!.userId, req.file);
    sendSuccess(res, "Document added", data, 201);
  } catch (error) { next(error); }
};

export const editCompanyDocument = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await updateCompanyDocument(req.params.id, req.body ?? {}, req.user!.userId, req.file);
    sendSuccess(res, "Document updated", data);
  } catch (error) { next(error); }
};

export const removeCompanyDocument = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Document removed", await deleteCompanyDocument(req.params.id));
  } catch (error) { next(error); }
};
