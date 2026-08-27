import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { runWithOrg } from "../utils/orgContext.js";
import { sendError } from "../utils/response.js";

/**
 * Establishes the tenant for a signed machine call.
 *
 * Every other route gets its organization from the authenticated user. The
 * integration API has no user, so without this the request-scoped org would be
 * null — and `scoped()` treats null as "no filter", which silently turns an
 * org-scoped query into one that reads every tenant. A payroll endpoint doing
 * that would hand one company's salaries to another company's accountant.
 *
 * So the organization is named explicitly by the caller, checked against the
 * database, and then installed for the rest of the chain.
 */
export function serviceOrgScope(req: Request, res: Response, next: NextFunction): void {
  const raw =
    (req.query.organizationId as string | undefined) ??
    (req.body?.organizationId as string | undefined);
  const organizationId = String(raw ?? "").trim();

  if (!organizationId) {
    sendError(res, "organizationId is required", 400);
    return;
  }
  if (!mongoose.isValidObjectId(organizationId)) {
    sendError(res, "organizationId is not a valid id", 400);
    return;
  }

  Organization.exists({ _id: organizationId })
    .then((found) => {
      if (!found) {
        sendError(res, "Organization not found", 404);
        return;
      }
      // isSuperAdmin stays false: a machine caller is scoped to the one tenant
      // it named, and must not inherit the switcher's ability to see past it.
      runWithOrg({ orgId: organizationId, isSuperAdmin: false }, next);
    })
    .catch(next);
}
