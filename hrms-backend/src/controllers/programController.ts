import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { ProgramService } from "../services/programService.js";
import { createProgramSchema, updateProgramSchema } from "../validations/programValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ProgramService();

// ── Managing ────────────────────────────────────────────────────────────────

export const createProgram = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createProgramSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const program = await service.create(parsed.data, req.user!.userId);

    // Announced on the way out, and only when it is actually open. A draft
    // nobody can book is not news, and announcing on a timer instead would
    // reach people the morning after it filled.
    if (program.status === "open") await service.announce(String(program._id));
    sendSuccess(res, "Program created", program, 201);
  } catch (error) { next(error); }
};

export const getPrograms = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Programs", await service.list(req.query as Record<string, string>));
  } catch (error) { next(error); }
};

export const getProgramById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Program", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateProgram = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateProgramSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }

    const before = await service.getById(req.params.id);
    const program = await service.update(req.params.id, parsed.data);
    // Publishing is the moment worth telling people about, so the announcement
    // fires on the draft → open transition rather than on every save.
    if (before.status !== "open" && parsed.data.status === "open") await service.announce(req.params.id);
    sendSuccess(res, "Program updated", program);
  } catch (error) { next(error); }
};

export const deleteProgram = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Program deleted", await service.remove(req.params.id));
  } catch (error) { next(error); }
};

/** Who is on it — the register, for whoever runs the program. */
export const getProgramRegistrations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Registrations", await service.registrations(req.params.id));
  } catch (error) { next(error); }
};

// ── Self-service ────────────────────────────────────────────────────────────

/**
 * What this person can book, and what they already have.
 *
 * No module permission: taking a place on a staff program is self-service, the
 * same as raising leave. The list only ever contains open programs that have
 * not started, so there is nothing here to withhold.
 */
export const getMyPrograms = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Programs", await service.listForUser(req.user!.userId));
  } catch (error) { next(error); }
};

export const registerForProgram = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "You have a place", await service.register(req.params.id, req.user!.userId));
  } catch (error) { next(error); }
};

export const cancelMyRegistration = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Your place has been given up", await service.cancel(req.params.id, req.user!.userId));
  } catch (error) { next(error); }
};
