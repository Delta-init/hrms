import type { Response, NextFunction } from "express";
import type { ZodTypeAny, z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendSuccess, sendError } from "../utils/response.js";
import * as svc from "../services/dayPlanService.js";
import {
  dayPlanSchema, addDayItemSchema, tickSchema, reorderSchema, lengthSchema, roundSchema, dayQuerySchema,
} from "../validations/dayPlanValidation.js";

/* Day plans (2026-11-26). Routines are HR's (tasks permission); "my day" is the person's own and needs none. */

type Handler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;

/** Parse, run, answer — every handler here has the same shape. */
function handle<S extends ZodTypeAny>(schema: S | null, from: "body" | "query", message: string, run: (req: AuthenticatedRequest, data: z.infer<S>) => Promise<unknown>, status = 200): Handler {
  return async (req, res, next) => {
    try {
      let data = undefined as z.infer<S>;
      if (schema) {
        const parsed = schema.safeParse(from === "body" ? req.body ?? {} : req.query);
        if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors as never); return; }
        data = parsed.data;
      }
      sendSuccess(res, message, await run(req, data), status);
    } catch (e) { next(e); }
  };
}
const me = (req: AuthenticatedRequest) => req.user!.userId;

export const listDayPlans = handle(null, "body", "Day plans", () => svc.listPlans());
export const getDayPlan = handle(null, "body", "Day plan", (req) => svc.getPlan(req.params.id));
export const createDayPlan = handle(dayPlanSchema, "body", "Day plan created", (req, d) => svc.createPlan(d, me(req)), 201);
export const updateDayPlan = handle(dayPlanSchema.partial(), "body", "Day plan saved", (req, d) => svc.updatePlan(req.params.id, d));
export const dayOfPlan = handle(dayQuerySchema, "query", "Day", (req, d) => svc.dayForPlan(req.params.id, d.date));

export const myDays = handle(null, "body", "Your day", (req) => svc.myDays(me(req)));
export const tickDayItem = handle(tickSchema, "body", "Saved", (req, d) => svc.tickItem(req.params.dayId, req.params.itemId, d.done, me(req)));
export const tickDayStep = handle(tickSchema, "body", "Saved", (req, d) => svc.tickStep(req.params.dayId, req.params.itemId, req.params.stepId, d.done, me(req)));
export const addDayItem = handle(addDayItemSchema, "body", "Added", (req, d) => svc.addItem(req.params.dayId, d, me(req)), 201);
export const reorderDay = handle(reorderSchema, "body", "Moved", (req, d) => svc.reorder(req.params.dayId, d.ids, me(req)));
export const setDayItemLength = handle(lengthSchema, "body", "Saved", (req, d) => svc.setLength(req.params.dayId, req.params.itemId, d.mins, me(req)));
export const removeDayItem = handle(null, "body", "Removed", (req) => svc.removeItem(req.params.dayId, req.params.itemId, me(req)));
export const dayRoundDone = handle(roundSchema, "body", "Round recorded", (req, d) => svc.roundDone(req.params.dayId, d.due, me(req)));

// ── The HR department (2026-11-26): access, and changes to someone's today ───

const isSuperAdmin = (req: AuthenticatedRequest) => !!req.user?.role?.isSystemRole && req.user.role.roleName === "Super Admin";

/** Day plans are the HR department's (and the Super Admin's) — "HR department only". */
export const requireHrDepartment: Handler = async (req, res, next) => {
  try {
    if (await svc.inHrDepartment(req.user!.userId, isSuperAdmin(req))) { next(); return; }
    sendError(res, "Day plans are for the HR department", 403);
  } catch (e) { next(e); }
};

export const dayPlanAccess = handle(null, "body", "Day plan access", async (req) => ({ allowed: await svc.inHrDepartment(req.user!.userId, isSuperAdmin(req)) }));
export const hrAddDayItem = handle(addDayItemSchema, "body", "Added", (req, d) => svc.addItem(req.params.dayId, d, me(req), true), 201);
export const hrReorderDay = handle(reorderSchema, "body", "Moved", (req, d) => svc.reorder(req.params.dayId, d.ids, me(req), true));
export const hrSetDayItemLength = handle(lengthSchema, "body", "Saved", (req, d) => svc.setLength(req.params.dayId, req.params.itemId, d.mins, me(req), true));
export const hrRemoveDayItem = handle(null, "body", "Removed", (req) => svc.removeItem(req.params.dayId, req.params.itemId, me(req), true));
