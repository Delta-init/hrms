import type { Response, NextFunction } from "express";
import type { ZodTypeAny, z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendSuccess } from "../utils/response.js";
import { viewerFrom, isObjectId, type DgoViewer } from "../services/dgo/dgoAccess.js";
import { dayIn } from "../services/dgo/dgoMath.js";
import * as read from "../services/dgo/dgoReadService.js";
import * as earning from "../services/dgo/dgoEarningService.js";
import * as budget from "../services/dgo/dgoBudgetService.js";
import * as settings from "../services/dgo/dgoSettingsService.js";
import {
  recordEarningSchema, decisionSchema, reverseSchema, collectionsSchema, settingsSchema, ruleSchema, programSchema,
} from "../validations/dgoValidation.js";

/**
 * DGO Points routes. Thin: each builds the viewer (organisation, own employee
 * record, departments headed, permissions) and hands it to a service, where
 * every authorisation decision is made and tested.
 */
type Handler = (v: DgoViewer, req: AuthenticatedRequest) => Promise<{ message: string; data: unknown; status?: number }>;

const handle = (fn: Handler) => async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const v = await viewerFrom(req.user!);
    const out = await fn(v, req);
    sendSuccess(res, out.message, out.data, out.status ?? 200);
  } catch (error) {
    next(error);
  }
};

class BadInput extends Error {
  statusCode = 400;
}

function parse<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadInput(parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

const idParam = (req: AuthenticatedRequest) => {
  if (!isObjectId(req.params.id)) throw new BadInput("Unknown request");
  return req.params.id;
};

const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const num = (x: unknown) => (typeof x === "string" && /^\d+$/.test(x) ? Number(x) : undefined);

export const getMe = handle(async (v) => ({ message: "DGO Points", data: await read.me(v) }));
export const getDashboard = handle(async (v, req) => ({ message: "Overview", data: await read.dashboard(v, str(req.query.month)) }));
export const getWallet = handle(async (v, req) => ({
  message: "Points",
  data: await read.wallet(v, { employeeId: str(req.query.employeeId), type: str(req.query.type), from: str(req.query.from), to: str(req.query.to), page: num(req.query.page), limit: num(req.query.limit) }),
}));
export const getLots = handle(async (v, req) => ({ message: "Point lots", data: await read.lots(v, str(req.query.employeeId)) }));
export const getRules = handle(async (v) => ({ message: "Earning rules", data: await settings.rulesView(v) }));
export const getEmployees = handle(async (v, req) => ({ message: "Employees", data: await read.employees(v, str(req.query.search)) }));

export const postEarning = handle(async (v, req) => {
  const out = await earning.recordEarning(v, parse(recordEarningSchema, req.body));
  return { message: out.message, data: { event: await read.eventDto(v, out.event), duplicate: out.duplicate }, status: out.duplicate ? 200 : 201 };
});
export const postReverse = handle(async (v, req) => {
  const ev = await earning.reverseEarning(v, idParam(req), parse(reverseSchema, req.body).reason);
  return { message: "Points taken back", data: { event: await read.eventDto(v, ev) } };
});

export const getApprovals = handle(async (v, req) => ({ message: "Approvals", data: await read.approvals(v, str(req.query.tab)) }));
export const postDecision = handle(async (v, req) => {
  const body = parse(decisionSchema, req.body);
  const out = await earning.decide(v, idParam(req), body.approve, body.note);
  return { message: out.message, data: { event: await read.eventDto(v, out.event) } };
});

export const getBudget = handle(async (v, req) => ({ message: "Budget", data: await budget.budgetView(v, str(req.query.month)) }));
export const postCollections = handle(async (v, req) => {
  const body = parse(collectionsSchema, req.body);
  return { message: "Entered — a second person confirms it", data: await budget.enterCollections(v, req.params.month, body.amountAed, body.note ?? undefined) };
});
export const postConfirmCollections = handle(async (v, req) => ({ message: "Confirmed", data: await budget.confirmCollections(v, req.params.month) }));
export const postRecount = handle(async (v, req) => ({ message: "Recounted", data: await budget.recountBudget(v, req.params.month) }));

export const getSettings = handle(async (v) => ({ message: "Settings", data: await settings.settingsView(v) }));
export const putSettings = handle(async (v, req) => ({ message: "Saved as a new version", data: await settings.saveSettings(v, parse(settingsSchema, req.body)) }));
export const putRule = handle(async (v, req) => ({ message: "Saved as a new version", data: await settings.saveRule(v, String(req.params.code), parse(ruleSchema, req.body)) }));
export const putProgram = handle(async (v, req) => {
  const data = await settings.saveProgram(v, parse(programSchema, req.body));
  // The month in progress takes the new grouping at once; earlier months keep theirs.
  await budget.refreshGrouping(v.orgId, dayIn(v.tz).slice(0, 7));
  return { message: "Saved", data };
});

export const getAudit = handle(async (v, req) => ({ message: "Audit", data: await read.audit(v, { page: num(req.query.page), limit: num(req.query.limit), action: str(req.query.action) }) }));
