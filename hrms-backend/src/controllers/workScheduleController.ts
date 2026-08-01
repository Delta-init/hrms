import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { WorkScheduleService } from "../services/workScheduleService.js";
import { AttendancePenaltyService } from "../services/attendancePenaltyService.js";
import { createWorkScheduleSchema, updateWorkScheduleSchema } from "../validations/workScheduleValidation.js";
import { createRosterAssignmentSchema, updateRosterAssignmentSchema } from "../validations/rosterValidation.js";
import { upsertAttendancePenaltyPolicySchema } from "../validations/attendancePenaltyValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new WorkScheduleService();
const penaltyService = new AttendancePenaltyService();

export const createWorkSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createWorkScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Work schedule created successfully", record, 201);
  } catch (error) {
    next(error);
  }
};

export const getWorkSchedules = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Work schedules retrieved successfully", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getAllWorkSchedulesSimple = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const records = await service.listSimple();
    sendSuccess(res, "Work schedules retrieved successfully", records);
  } catch (error) {
    next(error);
  }
};

export const getWorkScheduleById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.getById(req.params.id);
    sendSuccess(res, "Work schedule retrieved successfully", record);
  } catch (error) {
    next(error);
  }
};

export const updateWorkSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateWorkScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Work schedule updated successfully", record);
  } catch (error) {
    next(error);
  }
};

export const deleteWorkSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};

// ── Shift roster assignments ─────────────────────────────────────────────
export const assignRoster = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createRosterAssignmentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Shift assigned", await service.assignRoster(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getRosterAssignments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listRosterAssignments(req.query as Record<string, string>);
    sendSuccess(res, "Roster assignments retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const updateRosterAssignment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateRosterAssignmentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Assignment updated", await service.updateRosterAssignment(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteRosterAssignment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Assignment removed", await service.removeRosterAssignment(req.params.id));
  } catch (error) { next(error); }
};

// ── Late-arrival penalty policy ──────────────────────────────────────────
export const getAttendancePenaltyPolicy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Attendance penalty policy retrieved", await penaltyService.get());
  } catch (error) { next(error); }
};

export const updateAttendancePenaltyPolicy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = upsertAttendancePenaltyPolicySchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Attendance penalty policy updated", await penaltyService.upsert(parsed.data));
  } catch (error) { next(error); }
};
