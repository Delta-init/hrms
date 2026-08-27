import type { Request, Response } from "express";
import { directoryService } from "../services/directoryService.js";
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
