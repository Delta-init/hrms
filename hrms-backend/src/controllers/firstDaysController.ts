import type { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { FirstDaysService } from "../services/firstDaysService.js";
import { folderVideo, folderVideos, vimeoConnected } from "../services/vimeoService.js";
import { departmentsHeadedBy } from "../services/departmentHeadService.js";
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

/**
 * A homework video into storage, with its length read from the file — never
 * from the browser. Null when the file isn't a readable MP4.
 */
async function storeVideo(req: AuthenticatedRequest, employeeOrUser: string) {
  const file = req.file!;
  const seconds = mp4Duration(file.buffer);
  if (!seconds || seconds < 1) return null;
  const key = attachmentKey(getOrgId(), employeeOrUser, "first-days", "mp4", Date.now());
  await putObject(key, file.buffer, "video/mp4");
  return { file: { key, name: (file.originalname || "video.mp4").slice(0, 200) }, seconds: Math.round(seconds) };
}
const NOT_MP4 = "Could not read the video's length from the file. It must be a standard MP4.";

/** A new homework's title and day, from its multipart form. Null when the day is missing or malformed. */
function homeworkFields(req: AuthenticatedRequest) {
  const parsed = z.object({
    title: z.string().trim().max(160).default(""),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(req.body ?? {});
  return parsed.success ? parsed.data : null;
}

// ── The joiner ───────────────────────────────────────────────────────────────

export const getMyFirstDays = route(async (req, res) => {
  sendSuccess(res, "Your first days", await service.mine(req.user!.userId));
});

export const confirmMySession = route(async (req, res) => {
  sendSuccess(res, "Session confirmed", await service.confirmSessionMine(req.user!.userId));
});

export const answerMyHomework = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach your answer as a file", 400); return; }
  sendSuccess(res, "Answer handed in", await service.answerHomework(req.user!.userId, req.params.itemId, await storeDocument(req, req.user!.userId)));
});

export const startMyHomeworkVideo = route(async (req, res) => {
  sendSuccess(res, "Homework video", await service.startHomeworkVideo(req.user!.userId, req.params.itemId));
});

export const myHomeworkVideoBeat = route(async (req, res) => {
  const parsed = z.object({ position: z.coerce.number().min(0).max(100_000) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "A playback position is required", 400); return; }
  sendSuccess(res, "Progress recorded", await service.homeworkVideoBeat(req.user!.userId, req.params.itemId, parsed.data.position));
});

/** A video homework's write-up, as a multipart form: `notes`, and a file if they attach one. */
export const submitMyWriteUp = route(async (req, res) => {
  const parsed = z.object({ notes: z.string().max(4000) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Write what you learned", 400); return; }
  const file = req.file ? await storeDocument(req, req.user!.userId) : null;
  sendSuccess(res, "Write-up handed in", await service.submitWriteUp(req.user!.userId, req.params.itemId, parsed.data.notes, file));
});

export const submitMyRolePlay = route(async (req, res) => {
  const parsed = z.object({ link: z.string().trim().min(1, "Paste the chat link").max(500) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Paste the chat link", 400); return; }
  sendSuccess(res, "Role-play handed in", await service.submitRolePlay(req.user!.userId, parsed.data.link));
});

export const submitMyCallNotes = route(async (req, res) => {
  const parsed = z.object({ notes: z.string().max(4000) }).safeParse(req.body ?? {});
  if (!parsed.success) { sendError(res, "Write what you observed", 400); return; }
  sendSuccess(res, "Write-up handed in", await service.submitCallNotes(req.user!.userId, parsed.data.notes));
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

export const addHomework = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the question document", 400); return; }
  const fields = homeworkFields(req);
  if (!fields) { sendError(res, "Pick the day the homework is for", 400); return; }
  const file = await storeDocument(req, req.params.employeeId);
  sendSuccess(res, "Homework sent", await service.addHomework(req.params.employeeId, req.user!.userId, isHr(req), { ...fields, file }));
});

/** A video homework: checked before the video is stored, since it can be 250 MB. */
export const addVideoHomework = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the video (MP4)", 400); return; }
  const fields = homeworkFields(req);
  if (!fields) { sendError(res, "Pick the day the homework is for", 400); return; }
  await service.mayAddHomework(req.params.employeeId, req.user!.userId, isHr(req), fields.day);
  const stored = await storeVideo(req, req.params.employeeId);
  if (!stored) { sendError(res, NOT_MP4, 400); return; }
  sendSuccess(res, "Homework sent", await service.addHomework(req.params.employeeId, req.user!.userId, isHr(req), {
    ...fields, kind: "video", file: stored.file, videoSeconds: stored.seconds,
  }));
});

export const setHomeworkVideo = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the video (MP4)", 400); return; }
  const stored = await storeVideo(req, req.params.employeeId);
  if (!stored) { sendError(res, NOT_MP4, 400); return; }
  sendSuccess(res, "Video replaced", await service.setHomeworkQuestion(
    req.params.employeeId, req.params.itemId, req.user!.userId, isHr(req), { file: stored.file, video: { seconds: stored.seconds } }
  ));
});

export const setHomeworkQuestion = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the question document", 400); return; }
  const file = await storeDocument(req, req.params.employeeId);
  sendSuccess(res, "Question saved", await service.setHomeworkQuestion(req.params.employeeId, req.params.itemId, req.user!.userId, isHr(req), { file }));
});

// ── Video homework from the company's Vimeo folder ──────────────────────────

/** Heads and HR set homework; nobody else needs to see what is in the folder. */
async function setsHomework(req: AuthenticatedRequest) {
  return isHr(req) || (await departmentsHeadedBy(req.user!.userId)).length > 0;
}

/**
 * The videos in the company's Vimeo folder, each saying whether it can play
 * inside HRMS and, if not, what to change in Vimeo. `connected: false` until
 * the server has a Vimeo token and folder.
 */
export const listVimeoVideos = route(async (req, res) => {
  if (!(await setsHomework(req))) { sendError(res, "Only department heads and HR set homework", 403); return; }
  if (!vimeoConnected()) { sendSuccess(res, "Vimeo isn't connected", { connected: false, videos: [] }); return; }
  const videos = await folderVideos(req.query.fresh === "1");
  sendSuccess(res, "Vimeo videos", { connected: true, videos });
});

const vimeoPick = z.object({ vimeoId: z.string().regex(/^\d+$/, "Pick a video from the list") });
/** The picked video, checked with Vimeo now — its length is Vimeo's, never the browser's. */
async function pickedVimeo(body: unknown) {
  const parsed = vimeoPick.safeParse(body ?? {});
  if (!parsed.success) return null;
  const v = await folderVideo(parsed.data.vimeoId);
  return { ref: { id: v.id, hash: v.hash, name: v.name.slice(0, 200) }, seconds: v.durationSeconds };
}

export const addVimeoHomework = route(async (req, res) => {
  const fields = homeworkFields(req);
  if (!fields) { sendError(res, "Pick the day the homework is for", 400); return; }
  const picked = await pickedVimeo(req.body);
  if (!picked) { sendError(res, "Pick a video from the list", 400); return; }
  sendSuccess(res, "Homework sent", await service.addHomework(req.params.employeeId, req.user!.userId, isHr(req), {
    ...fields, kind: "video", vimeo: picked.ref, videoSeconds: picked.seconds,
  }));
});

export const setHomeworkVimeo = route(async (req, res) => {
  const picked = await pickedVimeo(req.body);
  if (!picked) { sendError(res, "Pick a video from the list", 400); return; }
  sendSuccess(res, "Video replaced", await service.setHomeworkQuestion(
    req.params.employeeId, req.params.itemId, req.user!.userId, isHr(req), { video: { seconds: picked.seconds, vimeo: picked.ref } }
  ));
});

export const addVimeoHomeworkToMany = route(async (req, res) => {
  const ids = z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(100).safeParse((req.body as { employeeIds?: unknown } | undefined)?.employeeIds);
  if (!ids.success) { sendError(res, "Pick at least one new joiner", 400); return; }
  const fields = homeworkFields(req);
  if (!fields) { sendError(res, "Pick the day the homework is for", 400); return; }
  const picked = await pickedVimeo(req.body);
  if (!picked) { sendError(res, "Pick a video from the list", 400); return; }
  const results = await service.addHomeworkToMany(ids.data, req.user!.userId, isHr(req), {
    ...fields, kind: "video", vimeo: picked.ref, videoSeconds: picked.seconds,
  });
  const sent = results.filter((r) => r.ok).length;
  sendSuccess(res, sent === results.length ? `Homework sent to ${sent}` : `Sent to ${sent} of ${results.length}`, results);
});

/**
 * One homework to several joiners. The form carries `employeeIds` as a JSON
 * list; the file is stored once and every joiner's guide points at the same copy.
 */
export const addHomeworkToMany = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the question document", 400); return; }
  let ids: unknown;
  try { ids = JSON.parse(String((req.body as { employeeIds?: unknown }).employeeIds ?? "[]")); } catch { ids = null; }
  const parsed = z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(100).safeParse(ids);
  if (!parsed.success) { sendError(res, "Pick at least one new joiner", 400); return; }
  const fields = homeworkFields(req);
  if (!fields) { sendError(res, "Pick the day the homework is for", 400); return; }
  const file = await storeDocument(req, req.user!.userId);
  const results = await service.addHomeworkToMany(parsed.data, req.user!.userId, isHr(req), { ...fields, file });
  const sent = results.filter((r) => r.ok).length;
  sendSuccess(res, sent === results.length ? `Homework sent to ${sent}` : `Sent to ${sent} of ${results.length}`, results);
});

/** One video homework to several joiners: the video is stored once and shared. */
export const addVideoHomeworkToMany = route(async (req, res) => {
  if (!req.file) { sendError(res, "Attach the video (MP4)", 400); return; }
  let ids: unknown;
  try { ids = JSON.parse(String((req.body as { employeeIds?: unknown }).employeeIds ?? "[]")); } catch { ids = null; }
  const parsed = z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(100).safeParse(ids);
  if (!parsed.success) { sendError(res, "Pick at least one new joiner", 400); return; }
  const fields = homeworkFields(req);
  if (!fields) { sendError(res, "Pick the day the homework is for", 400); return; }
  const stored = await storeVideo(req, req.user!.userId);
  if (!stored) { sendError(res, NOT_MP4, 400); return; }
  const results = await service.addHomeworkToMany(parsed.data, req.user!.userId, isHr(req), {
    ...fields, kind: "video", file: stored.file, videoSeconds: stored.seconds,
  });
  const sent = results.filter((r) => r.ok).length;
  sendSuccess(res, sent === results.length ? `Homework sent to ${sent}` : `Sent to ${sent} of ${results.length}`, results);
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
