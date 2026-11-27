import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AdSpendService } from "../services/adSpendService.js";
import { saveWeekSchema, updateSettingsSchema, monthParam } from "../validations/adSpendValidation.js";
import { hasPermission } from "../middleware/permissions.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { inHrDepartment } from "../services/dayPlanService.js";

const service = new AdSpendService();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const route = (fn: Handler) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { await fn(req, res); } catch (e) { next(e); }
};

/** An optional "YYYY-MM" query value, refused when present and malformed. */
function month(req: AuthenticatedRequest, res: Response, name: "from" | "to"): string | undefined | false {
  const raw = req.query[name];
  if (raw === undefined || raw === "") return undefined;
  const parsed = monthParam.safeParse(raw);
  if (!parsed.success) { sendError(res, `${name}: ${parsed.error.issues[0]?.message}`, 400); return false; }
  return parsed.data;
}

/*
 * The HR department (the user, 2026-11-27: "hr department can see and add in ad spend also"): everybody in a department
 * named "HR…" or "Human Resources…" — the same test Day plans uses — may read ad spend and log or correct a week, with
 * its files, whatever their role says. Setting the platforms and budget, deleting a week and exporting stay with the
 * roles that hold them.
 */
const HR_DEPARTMENT_MAY = new Set(["view", "create"]);
const isSuperAdmin = (req: AuthenticatedRequest) => !!req.user?.role?.isSystemRole && req.user.role.roleName === "Super Admin";

/** The role's `adSpend` permission for this action — or, for reading and logging, being in the HR department. */
export const adSpendAccess = (action: "view" | "create" | "edit" | "delete") =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (hasPermission(req.user?.role, "adSpend", action)) { next(); return; }
      if (HR_DEPARTMENT_MAY.has(action) && req.user && await inHrDepartment(req.user.userId, isSuperAdmin(req))) { next(); return; }
      sendError(res, `Access denied: you do not have '${action}' permission on 'adSpend'`, 403);
    } catch (e) { next(e); }
  };

/** What this person may do on the Ad spend page — the role's permission and, for reading and logging, the HR department. */
export const getAccess = route(async (req, res) => {
  const role = req.user?.role;
  const hr = !!req.user && await inHrDepartment(req.user.userId, isSuperAdmin(req));
  const can = (a: "view" | "create" | "edit" | "delete" | "export") => hasPermission(role, "adSpend", a) || (hr && HR_DEPARTMENT_MAY.has(a));
  sendSuccess(res, "Ad spend access", { view: can("view"), create: can("create"), edit: can("edit"), delete: can("delete"), export: can("export"), hrDepartment: hr });
});

/**
 * Who may read the platform names. The candidate form's source list needs
 * them, and the people adding candidates hold `hiring`, not `adSpend` — the
 * names of a few ad sites are not the budget.
 */
export const canReadPlatforms = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const role = req.user?.role;
  if (hasPermission(role, "adSpend", "view") || hasPermission(role, "hiring", "view")) { next(); return; }
  // The HR department reads the ad spend page, so its platforms too.
  void adSpendAccess("view")(req, res, next);
};

export const getSettings = route(async (_req, res) => {
  sendSuccess(res, "Ad spend settings", await service.getSettings());
});

export const updateSettings = route(async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
  sendSuccess(res, "Settings saved", await service.updateSettings(parsed.data, req.user!.userId));
});

export const getPlatformNames = route(async (_req, res) => {
  sendSuccess(res, "Platforms", await service.platformNames());
});

export const getRequisitions = route(async (_req, res) => {
  sendSuccess(res, "Hiring requests", await service.requisitions());
});

export const getOverview = route(async (req, res) => {
  const from = month(req, res, "from"); if (from === false) return;
  const to = month(req, res, "to"); if (to === false) return;
  sendSuccess(res, "Ad spend overview", await service.overview(from, to));
});

export const listWeeks = route(async (req, res) => {
  const from = month(req, res, "from"); if (from === false) return;
  const to = month(req, res, "to"); if (to === false) return;
  const s = await service.getSettings();
  const end = to ?? s.today.slice(0, 7);
  sendSuccess(res, "Weeks", await service.listWeeks(from ?? `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`, end));
});

export const getWeek = route(async (req, res) => {
  sendSuccess(res, "Week", await service.getWeek(req.params.weekStart));
});

export const saveWeek = route(async (req, res) => {
  const parsed = saveWeekSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const first = parsed.error.issues[0]?.message ?? "Validation failed";
    sendError(res, first, 400, flat.fieldErrors);
    return;
  }
  sendSuccess(res, "Week saved", await service.saveWeek(req.params.weekStart, parsed.data, req.user!.userId));
});

export const deleteWeek = route(async (req, res) => {
  sendSuccess(res, "Week removed", await service.deleteWeek(req.params.weekStart));
});

export const addAttachment = route(async (req, res) => {
  if (!req.file) { sendError(res, "Choose a file to attach", 400); return; }
  sendSuccess(res, "File attached", await service.addAttachment(req.params.weekStart, req.file, req.user!.userId), 201);
});

export const removeAttachment = route(async (req, res) => {
  sendSuccess(res, "File removed", await service.removeAttachment(req.params.weekStart, req.params.attachmentId));
});
