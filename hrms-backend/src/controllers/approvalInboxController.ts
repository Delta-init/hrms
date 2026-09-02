import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ApprovalInboxService, resolveInboxScope, scopeIsEmpty, type InboxScope } from "../services/approvalInboxService.js";
import { getOrgId } from "../utils/orgContext.js";
import { decideSchema, bulkDecideSchema } from "../validations/approvalInboxValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { ReviewerRole } from "../services/approvalWorkflowService.js";

const service = new ApprovalInboxService();

/**
 * Who this page is for, and how much of it they get.
 *
 * It reads across every organisation for a Super Admin, so everybody else has
 * to be narrowed before any query runs rather than filtered afterwards — the
 * scope is resolved once here and handed to every call, which is what makes it
 * impossible to add an endpoint that forgets.
 *
 * Refused outright only when the scope would show nothing: there is no reason
 * to render an approvals console for somebody with no queue in it, and a 403
 * says so more usefully than an empty page.
 */
async function scopeFor(req: AuthenticatedRequest, res: Response): Promise<InboxScope | null> {
  const scope = await resolveInboxScope(req.user!, getOrgId());
  if (scopeIsEmpty(scope)) {
    sendError(res, "You have no approvals to review", 403);
    return null;
  }
  return scope;
}

const reviewerRole = (req: AuthenticatedRequest): ReviewerRole =>
  req.user!.role as unknown as ReviewerRole;

export const getApprovalInbox = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = await scopeFor(req, res); if (!scope) return;
    sendSuccess(res, "Approvals", await service.list(req.query as Record<string, string>, scope));
  } catch (error) { next(error); }
};

/** Counts only — cheap enough for the dashboard to ask on every load. */
export const getApprovalSummary = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // The one endpoint that answers rather than refuses. The sidebar asks it on
    // every page load to decide whether to draw the link at all, and a hundred
    // employees generating a 403 apiece on every navigation would bury real
    // failures in the logs and pop an error toast at people who did nothing.
    const scope = await resolveInboxScope(req.user!, getOrgId());
    if (scopeIsEmpty(scope)) {
      sendSuccess(res, "Approvals summary", {
        canAccess: false,
        total: 0, stale: 0, staleAfterDays: 0, oldestRaisedAt: null, organizations: 0, byModule: [],
      });
      return;
    }
    sendSuccess(res, "Approvals summary", { canAccess: true, ...(await service.summary(scope)) });
  } catch (error) { next(error); }
};

export const getApprovalModules = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = await scopeFor(req, res); if (!scope) return;
    sendSuccess(res, "Approval types", service.modules(scope));
  } catch (error) { next(error); }
};

/** The full record behind a row, for the view panel. */
export const getApprovalDetail = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = await scopeFor(req, res); if (!scope) return;
    sendSuccess(res, "Approval detail", await service.detail(req.params.module, req.params.id, scope));
  } catch (error) { next(error); }
};

export const decideApproval = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = await scopeFor(req, res); if (!scope) return;
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.decide(
      req.params.module, req.params.id, parsed.data.approve, parsed.data.note, req.user!.userId, reviewerRole(req), scope
    );
    sendSuccess(res, parsed.data.approve ? "Approved" : "Rejected", result);
  } catch (error) { next(error); }
};

export const decideApprovalsBulk = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = await scopeFor(req, res); if (!scope) return;
    const parsed = bulkDecideSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const { module, ids, approve, note } = parsed.data;
    const result = await service.decideMany(module, ids, approve, note, req.user!.userId, reviewerRole(req), scope);

    // Partial failure is reported as such. "12 approved" while three quietly
    // failed is worse than not offering the bulk action.
    const message = result.failed.length
      ? `${result.succeeded} of ${result.requested} done — ${result.failed.length} could not be`
      : `${result.succeeded} ${approve ? "approved" : "rejected"}`;
    sendSuccess(res, message, result);
  } catch (error) { next(error); }
};
