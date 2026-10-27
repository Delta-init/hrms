import type { NextFunction, Response } from "express";
import { ProcurementService } from "../services/procurementService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { putObject, attachmentKey } from "../services/uploadService.js";
import { extFromMime } from "../middleware/upload.js";
import { getOrgId } from "../utils/orgContext.js";
import { hasPermission } from "../middleware/permissions.js";
import {
  createProcurementSchema, updateProcurementSchema, reviewProcurementSchema, resubmitProcurementSchema, giveOutSchema,
} from "../validations/procurementValidation.js";
import { procurementLedgerService, itemKey } from "../services/procurementLedgerService.js";

const service = new ProcurementService();

/**
 * Whoever reached this without holding `procurement.view` got in on heading
 * a department alone — narrow their list to it rather than let a route-level
 * bypass turn into seeing everybody's requests.
 */
const restrictionFor = (req: AuthenticatedRequest): string | undefined =>
  hasPermission(req.user?.role, "procurement", "view") ? undefined : req.user!.userId;

export const getProcurements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as never, restrictionFor(req));
    sendSuccess(res, "Procurement retrieved", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

/** GET /procurement/summary — how many in each status and their estimated cost, with the list's filters (2026-10-23). */
export const getProcurementSummary = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Procurement summary", await service.summary(req.query as never, restrictionFor(req)));
  } catch (error) {
    next(error);
  }
};

export const getProcurementById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Procurement retrieved", await service.getById(String(req.params.id), restrictionFor(req)));
  } catch (error) {
    next(error);
  }
};

/** A quote, spec sheet or photo — attached by the requester or their department head. */
export const uploadReport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) { sendError(res, "No file uploaded", 400); return; }
    const ext = extFromMime(req.file.mimetype);
    const key = attachmentKey(getOrgId(), req.params.id, "procurement-reports", ext, Date.now());
    await putObject(key, req.file.buffer, req.file.mimetype);
    sendSuccess(res, "Report attached", await service.setReport(req.params.id, key, req.file.originalname));
  } catch (error) { next(error); }
};

export const createProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Procurement created", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) {
    next(error);
  }
};

export const updateProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Procurement updated", await service.update(String(req.params.id), parsed.data));
  } catch (error) {
    next(error);
  }
};

export const reviewProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.review(String(req.params.id), parsed.data, req.user!.userId);
    sendSuccess(res, parsed.data.decision === "approve" ? "Sent to finance" : "Request rejected", record);
  } catch (error) {
    next(error);
  }
};

export const resubmitProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = resubmitProcurementSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    sendSuccess(res, "Request resubmitted", await service.resubmit(String(req.params.id), parsed.data));
  } catch (error) {
    next(error);
  }
};

export const deleteProcurement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Procurement deleted", await service.remove(String(req.params.id)));
  } catch (error) {
    next(error);
  }
};

// ── Ledger: what came in, what went out, what is left ──────────────────────

/** GET /procurement/ledger — one row per item. */
export const getLedger = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Procurement ledger", await procurementLedgerService.summary(typeof req.query.search === "string" ? req.query.search : undefined));
  } catch (error) { next(error); }
};

/** GET /procurement/ledger/item?key= — every movement of one item, with the running balance. */
export const getLedgerItem = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const key = typeof req.query.key === "string" ? itemKey(req.query.key) : "";
    if (!key) { sendError(res, "Which item?", 400); return; }
    sendSuccess(res, "Item ledger", await procurementLedgerService.movements(key));
  } catch (error) { next(error); }
};

/** POST /procurement/ledger/give-out */
export const giveOut = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = giveOutSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Given out", await procurementLedgerService.giveOut(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

/** DELETE /procurement/ledger/give-out/:id — an entry made in error. */
export const removeGiveOut = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Entry removed", await procurementLedgerService.removeGiveOut(String(req.params.id)));
  } catch (error) { next(error); }
};
