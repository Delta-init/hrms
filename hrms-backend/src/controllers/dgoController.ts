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
import * as rewards from "../services/dgo/dgoRewardService.js";
import * as achievers from "../services/dgo/dgoAchieverService.js";
import { leaderboard } from "../services/dgo/dgoLeaderboardService.js";
import { assertCanUse, canManageRewards } from "../services/dgo/dgoAccess.js";
import { httpError } from "../services/dgo/dgoErrors.js";
import { attachmentKey, putObject, publicUrl, UploadError } from "../services/uploadService.js";
import { extFromMime } from "../middleware/upload.js";
import {
  recordEarningSchema, decisionSchema, reverseSchema, collectionsSchema, settingsSchema, ruleSchema, programSchemaP2,
  nominateSchema, rewardSchema, redeemSchema, noteSchema, reasonSchema, pickSchema, adjustmentSchema, overrideSchema,
} from "../validations/dgoValidation.js";
import * as closing from "../services/dgo/dgoCloseService.js";
import * as control from "../services/dgo/dgoControlService.js";
import * as reports from "../services/dgo/dgoReportService.js";

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
  const data = await settings.saveProgram(v, parse(programSchemaP2, req.body));
  // The month in progress takes the new grouping at once; earlier months keep theirs.
  await budget.refreshGrouping(v.orgId, dayIn(v.tz).slice(0, 7));
  return { message: "Saved", data };
});

export const getAudit = handle(async (v, req) => ({
  message: "Audit",
  data: await read.audit(v, { page: num(req.query.page), limit: num(req.query.limit), action: str(req.query.action), entity: str(req.query.entity), actor: str(req.query.actor), from: str(req.query.from), to: str(req.query.to) }),
}));

/* ───────────── Phase 2 ───────────── */

/** A file for a nomination (evidence) or a reward (photo): stored now, its key sent back with the form. */
export const postUpload = handle(async (v, req) => {
  const kind = req.query.kind === "reward" ? "reward" : "evidence";
  if (kind === "reward") {
    if (!canManageRewards(v)) throw httpError("You can't add reward photos", 403);
  } else {
    await assertCanUse(v);
  }
  if (!req.file) throw new BadInput("No file uploaded");
  const key = attachmentKey(v.orgId, v.userId, kind === "reward" ? "dgo-rewards" : "dgo-evidence", extFromMime(req.file.mimetype), Date.now());
  try {
    await putObject(key, req.file.buffer, req.file.mimetype);
  } catch (e) {
    // Storage errors carry `status`; the error handler reads `statusCode`.
    if (e instanceof UploadError) throw httpError(e.message, e.status);
    throw e;
  }
  return { message: "Uploaded", data: { key, url: publicUrl(key), fileName: req.file.originalname, contentType: req.file.mimetype }, status: 201 };
});

export const getNominations = handle(async (v, req) => ({ message: "Nominations", data: await read.nominationsView(v, str(req.query.tab)) }));
export const getColleagues = handle(async (v, req) => ({ message: "Colleagues", data: await read.colleagues(v, str(req.query.search)) }));
export const postNomination = handle(async (v, req) => {
  const out = await earning.nominate(v, parse(nominateSchema, req.body));
  return { message: out.message, data: { event: await read.eventDto(v, out.event), duplicate: out.duplicate }, status: out.duplicate ? 200 : 201 };
});

export const getRewards = handle(async (v, req) => ({ message: "Rewards", data: await rewards.rewardsView(v, req.query.manage === "1") }));
export const postReward = handle(async (v, req) => ({ message: "Added", data: await rewards.createReward(v, parse(rewardSchema, req.body)), status: 201 }));
export const putReward = handle(async (v, req) => ({ message: "Saved", data: await rewards.updateReward(v, idParam(req), parse(rewardSchema, req.body)) }));
export const deleteReward = handle(async (v, req) => ({ message: "Removed from the store", data: await rewards.archiveReward(v, idParam(req)) }));

export const getRedemptions = handle(async (v, req) => ({ message: "Redemptions", data: await rewards.redemptionsView(v, str(req.query.tab)) }));
export const postRedemption = handle(async (v, req) => {
  const out = await rewards.redeem(v, parse(redeemSchema, req.body));
  return { message: out.message, data: { redemption: out.redemption, duplicate: out.duplicate }, status: out.duplicate ? 200 : 201 };
});
const redemptionStep = (fn: (v: DgoViewer, req: AuthenticatedRequest) => Promise<{ redemption: unknown; message: string }>) =>
  handle(async (v, req) => {
    const out = await fn(v, req);
    return { message: out.message, data: { redemption: out.redemption } };
  });
export const postCancelRedemption = redemptionStep((v, req) => rewards.cancelRedemption(v, idParam(req)));
export const postApproveRedemption = redemptionStep((v, req) => rewards.approveRedemption(v, idParam(req), parse(noteSchema, req.body ?? {}).note));
export const postRejectRedemption = redemptionStep((v, req) => rewards.rejectRedemption(v, idParam(req), parse(reasonSchema, req.body).reason));
export const postFulfilRedemption = redemptionStep((v, req) => rewards.fulfilRedemption(v, idParam(req), parse(noteSchema, req.body ?? {}).note));

export const getLeaderboard = handle(async (v, req) => ({ message: "Leaderboard", data: await leaderboard(v, { month: str(req.query.month), department: str(req.query.department) }) }));

const achieverStep = (fn: (v: DgoViewer, req: AuthenticatedRequest) => Promise<{ message: string } & Record<string, unknown>>) =>
  handle(async (v, req) => {
    const { message, ...data } = await fn(v, req);
    return { message, data };
  });
export const getAchievers = handle(async (v, req) => ({ message: "Monthly achievers", data: await achievers.achieversView(v, str(req.query.month)) }));
export const postFetchAchievers = achieverStep((v, req) => achievers.fetchAchievers(v, String(req.params.month)));
export const postPickAchiever = achieverStep((v, req) => {
  const b = parse(pickSchema, req.body);
  return achievers.pickWinner(v, String(req.params.month), b.code, b.email);
});
export const postVerifyAchievers = achieverStep((v, req) => achievers.verifyAchievers(v, String(req.params.month), parse(noteSchema, req.body ?? {}).note));
export const postSendBackAchievers = achieverStep((v, req) => achievers.sendBackAchievers(v, String(req.params.month), parse(reasonSchema, req.body).reason));
export const postApproveAchievers = achieverStep((v, req) => achievers.approveAchievers(v, String(req.params.month), parse(noteSchema, req.body ?? {}).note));

/* ───────────── Phase 3 ───────────── */

/** A step that answers with the month's budget page afterwards. */
const budgetStep = (fn: (v: DgoViewer, req: AuthenticatedRequest) => Promise<{ message: string }>) =>
  handle(async (v, req) => {
    const out = await fn(v, req);
    return { message: out.message, data: await budget.budgetView(v, String(req.params.month)) };
  });
export const postFetchCollections = handle(async (v, req) => ({ message: "Fetched from finance — a second person confirms it", data: await budget.fetchCollections(v, String(req.params.month)) }));
export const postCloseRequest = budgetStep((v, req) => closing.requestClose(v, String(req.params.month), parse(noteSchema, req.body ?? {}).note));
export const postCloseApprove = budgetStep((v, req) => closing.approveClose(v, String(req.params.month), parse(noteSchema, req.body ?? {}).note));
export const postCloseCancel = budgetStep((v, req) => closing.cancelClose(v, String(req.params.month), parse(reasonSchema, req.body).reason));

export const postOverride = handle(async (v, req) => {
  const out = await control.proposeOverride(v, String(req.params.month), parse(overrideSchema, req.body));
  return { message: out.message, data: { override: out.override }, status: 201 };
});
export const postOverrideApprove = handle(async (v, req) => {
  const out = await control.decideOverride(v, idParam(req), true, parse(noteSchema, req.body ?? {}).note);
  return { message: out.message, data: { override: out.override } };
});
export const postOverrideReject = handle(async (v, req) => {
  const out = await control.decideOverride(v, idParam(req), false, parse(reasonSchema, req.body).reason);
  return { message: out.message, data: { override: out.override } };
});

export const getAdjustments = handle(async (v, req) => ({ message: "Adjustments", data: await control.adjustmentsView(v, str(req.query.status)) }));
export const postAdjustment = handle(async (v, req) => {
  const out = await control.proposeAdjustment(v, parse(adjustmentSchema, req.body));
  return { message: out.message, data: { adjustment: out.adjustment }, status: 201 };
});
export const postAdjustmentApprove = handle(async (v, req) => {
  const out = await control.decideAdjustment(v, idParam(req), true, parse(noteSchema, req.body ?? {}).note);
  return { message: out.message, data: { adjustment: out.adjustment } };
});
export const postAdjustmentReject = handle(async (v, req) => {
  const out = await control.decideAdjustment(v, idParam(req), false, parse(reasonSchema, req.body).reason);
  return { message: out.message, data: { adjustment: out.adjustment } };
});

export const getReportsOverview = handle(async (v, req) => ({ message: "Reports", data: await reports.reportsOverview(v, str(req.query.month)) }));
export const getReconciliation = handle(async (v, req) => ({ message: "Reconciliation", data: await reports.reconciliation(v, str(req.query.month)) }));

/** CSV, not the JSON wrapper: a file to save. */
export const getExport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const v = await viewerFrom(req.user!);
    const out = await reports.exportCsv(v, str(req.query.kind), str(req.query.month));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send("\uFEFF" + out.body);
  } catch (error) {
    next(error);
  }
};

