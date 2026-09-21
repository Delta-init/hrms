import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { sendSuccess, sendError } from "../utils/response.js";
import {
  listRolesForPortal,
  describeUserForPortal,
  describeManyForPortal,
  setUserRoleFromPortal,
  provisionFromPortal,
} from "../services/portalService.js";

const router = Router();

/**
 * Server-to-server, from the Root portal only.
 *
 * Deliberately not the signed scheme the finance integration uses. That one
 * carries payroll and is worth the nonce and the signature; this one answers
 * questions about roles and accounts, and a shared secret compared in
 * constant time is the proportionate guard — the same one every other system
 * in the estate presents to the portal.
 *
 * Unconfigured means off, not open. A deployment that has not been told about
 * the portal must not expose its staff by default.
 */
function portalOnly(req: Request, res: Response, next: NextFunction): void {
  if (!env.ROOT_ERP_SECRET) {
    sendError(res, "The Root portal integration is not configured — set ROOT_ERP_SECRET", 503);
    return;
  }
  const presented = req.headers["x-portal-secret"];
  if (typeof presented !== "string") {
    sendError(res, "Bad secret", 401);
    return;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(env.ROOT_ERP_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    sendError(res, "Bad secret", 401);
    return;
  }
  next();
}

router.use(portalOnly);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const orgOf = (req: Request) =>
  typeof req.query.remoteOrgId === "string" ? req.query.remoteOrgId : undefined;

/** The roles this organization may use, and what each one permits. */
router.get(
  "/roles",
  wrap(async (req, res) => {
    sendSuccess(res, "Roles", await listRolesForPortal(orgOf(req)));
  }),
);

/** What one account actually holds here — the portal's check against drift. */
router.get(
  "/user",
  wrap(async (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email : "";
    if (!email) { sendError(res, "email is required", 400); return; }
    sendSuccess(res, "Account", await describeUserForPortal({ email, remoteOrgId: orgOf(req) }));
  }),
);

/** Change an existing account's role or status. Creates nothing. */
router.post(
  "/set-user-role",
  wrap(async (req, res) => {
    const { email, role, status, remoteOrgId } = (req.body ?? {}) as Record<string, string>;
    if (!email) { sendError(res, "email is required", 400); return; }
    sendSuccess(res, "Changed", await setUserRoleFromPortal({
      email, role, status, remoteOrgId: remoteOrgId ?? orgOf(req),
    }));
  }),
);

/** Create an account here, because a root admin asked. */
router.post(
  "/provision-user",
  wrap(async (req, res) => {
    const { email, name, role, remoteOrgId } = (req.body ?? {}) as Record<string, string>;
    if (!email || !role) { sendError(res, "email and role are required", 400); return; }
    sendSuccess(res, "Account created", await provisionFromPortal({
      email, name: name ?? "", role, remoteOrgId: remoteOrgId ?? orgOf(req),
    }));
  }),
);

/**
 * The same question as /user, asked about many people at once.
 *
 * POST rather than GET because a page of addresses does not belong in a query
 * string, where it would be logged by every proxy in front of this. The
 * organization may arrive either way, as it does for the other POSTs here.
 */
router.post(
  "/accounts",
  wrap(async (req, res) => {
    const { emails, remoteOrgId } = (req.body ?? {}) as { emails?: unknown; remoteOrgId?: string };
    sendSuccess(res, "Accounts", await describeManyForPortal({
      emails, remoteOrgId: remoteOrgId ?? orgOf(req),
    }));
  }),
);

export default router;
