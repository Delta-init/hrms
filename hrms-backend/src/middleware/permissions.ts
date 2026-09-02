import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest, HrmsModule, PermissionAction } from "../types/index.js";
import { sendError } from "../utils/response.js";
import { departmentsHeadedBy, headsDepartmentOf } from "../services/departmentHeadService.js";

/**
 * Middleware factory that checks if the authenticated user's role
 * has the required permission for a given module.
 */
export const checkPermission = (module: HrmsModule, action: PermissionAction) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.role;

    if (!role) {
      sendError(res, "Role information missing", 403);
      return;
    }

    // Super Admin role has unrestricted access
    if (role.isSystemRole && role.roleName === "Super Admin") {
      next();
      return;
    }

    const modulePerms = role.permissions?.[module];

    if (!modulePerms) {
      sendError(res, `Access denied: no permissions defined for module '${module}'`, 403);
      return;
    }

    if (!modulePerms[action]) {
      sendError(
        res,
        `Access denied: you do not have '${action}' permission on '${module}'`,
        403
      );
      return;
    }

    next();
  };
};


/** The same test `checkPermission` makes, as a question rather than a gate. */
export function hasPermission(
  role: NonNullable<AuthenticatedRequest["user"]>["role"] | undefined,
  module: HrmsModule,
  action: PermissionAction
): boolean {
  if (!role) return false;
  if (role.isSystemRole && role.roleName === "Super Admin") return true;
  return Boolean(role.permissions?.[module]?.[action]);
}

/**
 * The permission, or heading the department the request came from.
 *
 * A head is not given the `approve` permission, and should not be: that
 * permission is company-wide, so granting it to unlock one team would hand them
 * everybody's leave. The narrower claim — "this person reports into a department
 * I run" — is checked here instead, against the specific record being decided
 * rather than against the route.
 *
 * `requesterOf` is what makes that possible. Without it there is no record to
 * test and this can only answer the weaker question of whether the caller heads
 * anything at all, which is enough for a list the service scopes afterwards but
 * never enough for a decision. So a decision route must pass one; a route that
 * does not is trusting its own scoping, and says so at the call site.
 *
 * Additive by construction: whoever holds the permission is admitted first and
 * never reaches the department lookup, so opening this to heads cannot remove
 * anybody from a queue they were already clearing, and costs them no extra
 * query.
 */
export const checkPermissionOrDepartmentHead = (
  module: HrmsModule,
  action: PermissionAction,
  requesterOf?: (req: AuthenticatedRequest) => Promise<string | null>
) => {
  const permission = checkPermission(module, action);
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (hasPermission(req.user?.role, module, action)) {
      next();
      return;
    }

    const userId = req.user?.userId;
    const heads = userId ? await departmentsHeadedBy(userId) : [];
    if (!heads.length) {
      // Not a head either: let the permission check refuse it, so the caller
      // gets the message they would have got before any of this existed.
      permission(req, res, next);
      return;
    }
    if (!requesterOf) {
      next();
      return;
    }

    const requester = await requesterOf(req);
    if (requester && (await headsDepartmentOf(userId!, requester))) {
      next();
      return;
    }
    sendError(
      res,
      requester
        ? "That request is not from your department, so it is HR's to decide"
        : "That request no longer exists",
      requester ? 403 : 404
    );
  };
};

/** Reads the requester off a record by id, for the gate above. */
export const requesterFromRecord =
  (load: (id: string) => Promise<{ user?: unknown } | null>) =>
  async (req: AuthenticatedRequest): Promise<string | null> => {
    const doc = await load(req.params.id);
    return doc?.user ? String(doc.user) : null;
  };
