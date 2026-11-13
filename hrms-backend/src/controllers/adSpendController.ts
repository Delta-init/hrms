import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AdSpendService } from "../services/adSpendService.js";
import { saveWeekSchema, updateSettingsSchema, monthParam } from "../validations/adSpendValidation.js";
import { hasPermission } from "../middleware/permissions.js";
import { sendSuccess, sendError } from "../utils/response.js";

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

/**
 * Who may read the platform names. The candidate form's source list needs
 * them, and the people adding candidates hold `hiring`, not `adSpend` — the
 * names of a few ad sites are not the budget.
 */
export const canReadPlatforms = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const role = req.user?.role;
  if (hasPermission(role, "adSpend", "view") || hasPermission(role, "hiring", "view")) { next(); return; }
  sendError(res, "Access denied", 403);
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
