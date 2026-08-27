import type { Request, Response } from "express";
import { directoryService } from "../services/directoryService.js";
import { payrollHandoverService } from "../services/payrollHandoverService.js";
import { payrollBatchService } from "../services/payrollBatchService.js";
import { sendSuccess, sendError } from "../utils/response.js";

/**
 * The integration surface Delta Finance reads. Authenticated by shared-secret
 * signature (see middleware/serviceAuth.ts), not by a user session — there is
 * no person behind these calls and therefore no org context to inherit, so
 * every handler requires the organization to be named explicitly.
 */

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      sendError(res, (err as Error).message || "Integration request failed", status);
    });
  };

export const listOrganizations = asyncRoute(async (_req, res) => {
  sendSuccess(res, "Organizations retrieved", await directoryService.organizations());
});

export const listDepartments = asyncRoute(async (req, res) => {
  const organizationId = String(req.query.organizationId ?? "").trim();
  if (!organizationId) {
    sendError(res, "organizationId is required", 400);
    return;
  }
  sendSuccess(res, "Departments retrieved", await directoryService.departments(organizationId));
});

export const listEmployees = asyncRoute(async (req, res) => {
  const organizationId = String(req.query.organizationId ?? "").trim();
  if (!organizationId) {
    sendError(res, "organizationId is required", 400);
    return;
  }
  const result = await directoryService.employees(organizationId, {
    updatedSince: req.query.updatedSince ? String(req.query.updatedSince) : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    includeInactive: String(req.query.includeInactive ?? "") === "true",
  });
  sendSuccess(res, "Employees retrieved", result.rows, 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: Math.ceil(result.total / result.limit),
    hasNextPage: result.page * result.limit < result.total,
    hasPrevPage: result.page > 1,
  });
});

/** Lets the finance server prove its credentials are right before a real sync. */
export const ping = asyncRoute(async (_req, res) => {
  sendSuccess(res, "Integration reachable", { service: "hrms", time: new Date().toISOString() });
});

// ── Payroll handover ────────────────────────────────────────────────────────
// These carry money and bank details, unlike the directory above. They serve
// only months HR has actually submitted; an unsubmitted month is not visible
// here at all.

const MONTH = /^\d{4}-\d{2}$/;

function requireMonth(req: Request, res: Response): string | null {
  const month = String(req.params.month ?? "").trim();
  if (!MONTH.test(month)) {
    sendError(res, "Month must be in YYYY-MM format", 400);
    return null;
  }
  return month;
}

export const listHandoverBatches = asyncRoute(async (req, res) => {
  const organizationId = String(req.query.organizationId);
  const status = req.query.status ? String(req.query.status) : undefined;
  sendSuccess(res, "Payroll batches retrieved", await payrollHandoverService.listBatches(organizationId, status));
});

export const getHandoverBatch = asyncRoute(async (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;
  const organizationId = String(req.query.organizationId);
  sendSuccess(res, "Payroll batch retrieved", await payrollHandoverService.getBatch(organizationId, month));
});

/**
 * Accounts take possession of a month.
 *
 * Idempotent on the finance run id, because the caller may retry after a
 * timeout it cannot distinguish from a failure. A repeat of the same claim is
 * the answer it already had, not a second entry in the history; a claim by a
 * *different* run is refused, since two payroll runs importing one month is
 * how a month gets paid twice.
 */
export const claimHandoverBatch = asyncRoute(async (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;
  const financeRunId = String(req.body?.financeRunId ?? "").trim();
  if (!financeRunId) {
    sendError(res, "financeRunId is required", 400);
    return;
  }

  const current = await payrollBatchService.describe(month);
  if (current.status === "in_finance") {
    if (current.financeRunId && current.financeRunId !== financeRunId) {
      sendError(res, `${month} has already been imported by another payroll run (${current.financeRunId})`, 409);
      return;
    }
    sendSuccess(res, `${month} was already claimed`, current);
    return;
  }

  const batch = await payrollBatchService.transition(month, "in_finance", {
    actor: "finance",
    financeRunId,
    note: `Imported as ${financeRunId}`,
  });
  sendSuccess(res, `${month} claimed by accounts`, batch);
});

