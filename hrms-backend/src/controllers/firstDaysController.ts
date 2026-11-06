import type { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { FirstDaysService } from "../services/firstDaysService.js";
import { putObject, attachmentKey } from "../services/uploadService.js";
import { documentExt } from "../middleware/upload.js";
import { mp4Duration } from "./agreementController.js";
import { hasPermission } from "../middleware/permissions.js";
import { getOrgId } from "../utils/orgContext.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new FirstDaysService();

/** HR, for this feature: whoever may run onboarding tasks. */
const isHr = (req: AuthenticatedRequest) => hasPermission(req.user?.role, "onboardingTasks", "edit");

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const route = (fn: Handler) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { await fn(req, res); } catch (e) { next(e); }
};

/** A homework file into storage, under the joiner it belongs to. */
async function storeDocument(req: AuthenticatedRequest, employeeOrUser: string) {
  const file = req.file!;
  const key = attachmentKey(getOrgId(), employeeOrUser, "first-days", documentExt(file.mimetype), Date.now());
  await putObject(key, file.buffer, file.mimetype);
  return { key, name: (file.originalname || "File").slice(0, 200) };
}

// ── The joiner ───────────────────────────────────────────────────────────────

export const getMyFirstDays = route(async (req, res) => {
  sendSuccess(res, "Your first days", await service.mine(req.user!.userId));
});

export const confirmMySession = route(async (req, res) => {
  sendSuccess(res, "Session confirmed", await service.confirmSessionMine(req.user!.userId));
});

export const handInMyHomework = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach your homework file", 400); return; }
  sendSuccess(res, "Homework handed in", await service.handInHomework(req.user!.userId, await storeDocument(req, req.user!.userId)));
});

export const submitMyRolePlay = route(async (req, res) => {
  const parsed = z.object({ link: z.string().trim().min(1, "Paste the chat link").max(500) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Paste the chat link", 400); return; }
  sendSuccess(res, "Role-play handed in", await service.submitRolePlay(req.user!.userId, parsed.data.link));
});

export const myCallsDone = route(async (req, res) => {
  sendSuccess(res, "Cold calls done", await service.callsDone(req.user!.userId));
});

export const startMyTeamVideo = route(async (req, res) => {
  sendSuccess(res, "Team video", await service.startTeamVideo(req.user!.userId));
});

export const myTeamVideoBeat = route(async (req, res) => {
  const parsed = z.object({ position: z.coerce.number().min(0).max(100_000) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "A playback position is required", 400); return; }
  sendSuccess(res, "Progress recorded", await service.teamVideoBeat(req.user!.userId, parsed.data.position));
});

// ── Heads and HR ─────────────────────────────────────────────────────────────

/** The joiners this person looks after. Empty, not refused, for everyone else. */
export const getTeamFirstDays = route(async (req, res) => {
  sendSuccess(res, "New joiners", await service.team(req.user!.userId, isHr(req)));
});

export const confirmSessionAsHead = route(async (req, res) => {
  sendSuccess(res, "Session confirmed", await service.confirmSessionHead(req.params.employeeId, req.user!.userId, isHr(req)));
});

export const sendHomework = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the homework file", 400); return; }
  const file = await storeDocument(req, req.params.employeeId);
  sendSuccess(res, "Homework sent", await service.sendHomework(req.params.employeeId, req.user!.userId, isHr(req), file));
});

export const setToolAccess = route(async (req, res) => {
  const parsed = z.object({ tool: z.enum(["threeCx", "zoho", "crm"]), given: z.boolean() }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Say which tool, and whether it is given", 400); return; }
  sendSuccess(res, "Access updated", await service.setAccess(req.params.employeeId, req.user!.userId, isHr(req), parsed.data.tool, parsed.data.given));
});

export const assignClients = route(async (req, res) => {
  sendSuccess(res, "Clients assigned", await service.assignClients(req.params.employeeId, req.user!.userId, isHr(req)));
});

// ── The team video ───────────────────────────────────────────────────────────

export const getTeamVideo = route(async (req, res) => {
  sendSuccess(res, "Team video", await service.teamVideoForDepartment(req.params.departmentId, req.user!.userId, isHr(req)));
});

/** Same MP4 rules as the induction video: its length read from the file, never from the browser. */
export const uploadTeamVideo = route(async (req, res) => {
  if (!req.file) { sendError(res, "An MP4 is required", 400); return; }
  // Refused before a 250 MB file is stored, not after.
  await service.mayManageTeamVideo(req.params.departmentId, req.user!.userId, isHr(req));
  const seconds = mp4Duration(req.file.buffer);
  if (!seconds || seconds < 1) { sendError(res, "Could not read the video's length from the file. It must be a standard MP4.", 400); return; }
  const key = attachmentKey(getOrgId(), req.params.departmentId, "team-videos", "mp4", Date.now());
  await putObject(key, req.file.buffer, "video/mp4");
  const saved = await service.saveTeamVideo(req.params.departmentId, req.user!.userId, isHr(req), {
    key, fileName: req.file.originalname ?? "video.mp4", durationSeconds: Math.round(seconds), title: req.body?.title as string | undefined,
  });
  sendSuccess(res, `Team video uploaded — ${Math.round(seconds)}s`, saved, 201);
});
