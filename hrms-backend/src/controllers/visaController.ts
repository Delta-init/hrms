import type { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { VisaService } from "../services/visaService.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new VisaService();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const route = (fn: Handler) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { await fn(req, res); } catch (e) { next(e); }
};

// ── The employee ─────────────────────────────────────────────────────────────

export const getMyVisa = route(async (req, res) => {
  sendSuccess(res, "Visa status", await service.myStatus(req.user!.userId));
});

export const submitMyVisa = route(async (req, res) => {
  if (!req.file) { sendError(res, "Upload your visa — a PDF or a clear photo", 400); return; }
  const parsed = z.object({
    kind: z.enum(["visa", "renewal"]).default("visa"),
    expiryDate: z.string().trim().optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Say whether this is your visa or a renewal under way", 400); return; }
  sendSuccess(res, "Sent to HR", await service.submit(req.user!.userId, parsed.data, req.file), 201);
});

// ── HR ───────────────────────────────────────────────────────────────────────

export const listSubmissions = route(async (req, res) => {
  sendSuccess(res, "Visa updates", await service.list(typeof req.query.status === "string" ? req.query.status : undefined));
});

export const pendingCount = route(async (_req, res) => {
  sendSuccess(res, "Waiting", { pending: await service.pendingCount() });
});

export const outstanding = route(async (_req, res) => {
  sendSuccess(res, "Still to update", await service.outstanding());
});

export const approveSubmission = route(async (req, res) => {
  sendSuccess(res, "Approved", await service.approve(req.params.id, req.user!.userId));
});

export const rejectSubmission = route(async (req, res) => {
  const parsed = z.object({ note: z.string().max(500) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Say what needs fixing", 400); return; }
  sendSuccess(res, "Sent back", await service.reject(req.params.id, req.user!.userId, parsed.data.note));
});

export const setNotRequired = route(async (req, res) => {
  const parsed = z.object({ notRequired: z.boolean() }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Say whether a visa is needed", 400); return; }
  sendSuccess(res, parsed.data.notRequired ? "Marked as not needing a visa" : "Visa needed again", await service.setNotRequired(req.params.employeeId, parsed.data.notRequired));
});
