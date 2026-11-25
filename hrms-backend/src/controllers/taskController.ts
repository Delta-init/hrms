import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { TaskService } from "../services/taskService.js";
import {
  createTaskSchema, updateTaskSchema, stepToggleSchema, submitTaskSchema, reviewTaskSchema, cancelTaskSchema,
  listTaskSchema, categorySchema, updateSeriesSchema, seriesStateSchema,
} from "../validations/taskValidation.js";
import { sendSuccess, sendError, buildPagination } from "../utils/response.js";
import { putObject, attachmentKey } from "../services/uploadService.js";
import { extFromMime } from "../middleware/upload.js";
import { getOrgId } from "../utils/orgContext.js";
import { hasPermission } from "../middleware/permissions.js";
import { listSeries, getSeries, updateSeries, setSeriesState } from "../services/taskSeriesService.js";

const service = new TaskService();
type Handler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
const can = (req: AuthenticatedRequest, action: "view" | "create" | "edit" | "approve") => hasPermission(req.user?.role, "tasks", action);
const bad = (res: Response, error: { flatten: () => { fieldErrors: unknown } }) =>
  sendError(res, "Validation failed", 400, error.flatten().fieldErrors as never);

export const listTasks: Handler = async (req, res, next) => {
  try {
    const parsed = listTaskSchema.safeParse(req.query);
    if (!parsed.success) { bad(res, parsed.error); return; }
    // Your own tasks need nothing; everyone else's needs tasks:view.
    if (parsed.data.scope !== "mine" && !can(req, "view")) { sendError(res, "You don't have access to everyone's tasks", 403); return; }
    const out = await service.list(parsed.data, req.user!.userId);
    sendSuccess(res, "Tasks", out.records, 200, buildPagination(out.total, out.page, out.limit));
  } catch (e) { next(e); }
};

export const taskSummary: Handler = async (_req, res, next) => {
  try { sendSuccess(res, "Task summary", await service.summary()); } catch (e) { next(e); }
};

export const myTaskSummary: Handler = async (req, res, next) => {
  try { sendSuccess(res, "Your tasks", await service.mySummary(req.user!.userId)); } catch (e) { next(e); }
};

export const getTask: Handler = async (req, res, next) => {
  try { sendSuccess(res, "Task", await service.get(req.params.id, { userId: req.user!.userId, canView: can(req, "view") })); }
  catch (e) { next(e); }
};

export const createTask: Handler = async (req, res, next) => {
  try {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    const out = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, out.created === 1 ? "Task assigned" : `Task assigned to ${out.created} people`, out, 201);
  } catch (e) { next(e); }
};

export const updateTask: Handler = async (req, res, next) => {
  try {
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    sendSuccess(res, "Task updated", await service.update(req.params.id, parsed.data, req.user!.userId));
  } catch (e) { next(e); }
};

export const cancelTask: Handler = async (req, res, next) => {
  try {
    const parsed = cancelTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) { bad(res, parsed.error); return; }
    sendSuccess(res, "Task cancelled", await service.cancel(req.params.id, parsed.data.note, req.user!.userId));
  } catch (e) { next(e); }
};

export const toggleTaskStep: Handler = async (req, res, next) => {
  try {
    const parsed = stepToggleSchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    sendSuccess(res, "Step updated", await service.toggleStep(req.params.id, req.params.stepId, parsed.data.done, req.user!.userId));
  } catch (e) { next(e); }
};

/** Mark done — JSON, or multipart with a proof file and a `note` field. */
export const submitTask: Handler = async (req, res, next) => {
  try {
    const parsed = submitTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) { bad(res, parsed.error); return; }
    let fileKey: string | undefined;
    let fileName: string | undefined;
    if (req.file) {
      fileKey = attachmentKey(getOrgId(), req.user!.userId, "task-proof", extFromMime(req.file.mimetype), Date.now());
      await putObject(fileKey, req.file.buffer, req.file.mimetype);
      fileName = req.file.originalname;
    }
    const task = await service.submit(req.params.id, { note: parsed.data.note, fileKey, fileName }, req.user!.userId);
    sendSuccess(res, task.status === "done" ? "Task done" : "Sent to HR for approval", task);
  } catch (e) { next(e); }
};

export const reviewTask: Handler = async (req, res, next) => {
  try {
    const parsed = reviewTaskSchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    const task = await service.review(req.params.id, parsed.data.decision, parsed.data.note, req.user!.userId);
    sendSuccess(res, parsed.data.decision === "approve" ? "Task approved" : "Task sent back", task);
  } catch (e) { next(e); }
};

export const listTaskCategories: Handler = async (req, res, next) => {
  try { sendSuccess(res, "Task categories", await service.categories(req.query.all === "true" && can(req, "edit"))); } catch (e) { next(e); }
};

export const createTaskCategory: Handler = async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    sendSuccess(res, "Category added", await service.createCategory(parsed.data), 201);
  } catch (e) { next(e); }
};

export const updateTaskCategory: Handler = async (req, res, next) => {
  try {
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    sendSuccess(res, "Category updated", await service.updateCategory(req.params.id, parsed.data));
  } catch (e) { next(e); }
};

// ── Repeating tasks (Part 2) ─────────────────────────────────────────────────

export const listTaskSeries: Handler = async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" && ["active", "paused", "ended"].includes(req.query.state) ? req.query.state : undefined;
    sendSuccess(res, "Repeating tasks", await listSeries(state));
  } catch (e) { next(e); }
};

export const getTaskSeries: Handler = async (req, res, next) => {
  try { sendSuccess(res, "Repeating task", await getSeries(req.params.id)); } catch (e) { next(e); }
};

export const updateTaskSeries: Handler = async (req, res, next) => {
  try {
    const parsed = updateSeriesSchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    sendSuccess(res, "Repeating task updated", await updateSeries(req.params.id, parsed.data, req.user!.userId));
  } catch (e) { next(e); }
};

export const setTaskSeriesState: Handler = async (req, res, next) => {
  try {
    const parsed = seriesStateSchema.safeParse(req.body);
    if (!parsed.success) { bad(res, parsed.error); return; }
    const words = { active: "Resumed", paused: "Paused", ended: "Stopped" } as const;
    sendSuccess(res, words[parsed.data.state], await setSeriesState(req.params.id, parsed.data.state, req.user!.userId));
  } catch (e) { next(e); }
};
