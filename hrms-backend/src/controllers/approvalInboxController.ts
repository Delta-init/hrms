import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ApprovalInboxService } from "../services/approvalInboxService.js";
import { decideSchema, bulkDecideSchema } from "../validations/approvalInboxValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { ReviewerRole } from "../services/approvalWorkflowService.js";

const service = new ApprovalInboxService();

/**
 * This inbox reads across every organisation, so the route is closed to
 * anybody who is not a Super Admin — the org scoping every other endpoint
 * relies on is deliberately not applied here.
 */
function requireManagement(req: AuthenticatedRequest, res: Response): boolean {
  const role = req.user!.role as unknown as { roleName?: string; isSystemRole?: boolean };
  if (role?.isSystemRole && role.roleName === "Super Admin") return true;
  sendError(res, "This approvals console is for management only", 403);
  return false;
}

const reviewerRole = (req: AuthenticatedRequest): ReviewerRole =>
  req.user!.role as unknown as ReviewerRole;

export const getApprovalInbox = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireManagement(req, res)) return;
    sendSuccess(res, "Approvals", await service.list(req.query as Record<string, string>));
  } catch (error) { next(error); }
};

/** Counts only — cheap enough for the dashboard to ask on every load. */
export const getApprovalSummary = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireManagement(req, res)) return;
    sendSuccess(res, "Approvals summary", await service.summary());
  } catch (error) { next(error); }
};

export const getApprovalModules = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireManagement(req, res)) return;
    sendSuccess(res, "Approval types", service.modules());
  } catch (error) { next(error); }
};

/** The full record behind a row, for the view panel. */
export const getApprovalDetail = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireManagement(req, res)) return;
    sendSuccess(res, "Approval detail", await service.detail(req.params.module, req.params.id));
  } catch (error) { next(error); }
};

export const decideApproval = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireManagement(req, res)) return;
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.decide(
      req.params.module, req.params.id, parsed.data.approve, parsed.data.note, req.user!.userId, reviewerRole(req)
    );
    sendSuccess(res, parsed.data.approve ? "Approved" : "Rejected", result);
  } catch (error) { next(error); }
};

export const decideApprovalsBulk = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireManagement(req, res)) return;
    const parsed = bulkDecideSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const { module, ids, approve, note } = parsed.data;
    const result = await service.decideMany(module, ids, approve, note, req.user!.userId, reviewerRole(req));

    // Partial failure is reported as such. "12 approved" while three quietly
    // failed is worse than not offering the bulk action.
    const message = result.failed.length
      ? `${result.succeeded} of ${result.requested} done — ${result.failed.length} could not be`
      : `${result.succeeded} ${approve ? "approved" : "rejected"}`;
    sendSuccess(res, message, result);
  } catch (error) { next(error); }
};
