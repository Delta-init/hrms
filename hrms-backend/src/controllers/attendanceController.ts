import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AttendanceService } from "../services/attendanceService.js";
import { createAttendanceSchema, updateAttendanceSchema, punchContextSchema } from "../validations/attendanceValidation.js";
import { buildPunchContext } from "../utils/punchContext.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { Employee } from "../models/Employee.js";
import { scoped } from "../utils/orgContext.js";

const service = new AttendanceService();

function canManage(req: AuthenticatedRequest): boolean {
  return !!req.user?.role?.permissions?.attendance?.edit || req.user?.role?.roleName === "Super Admin";
}


export const createAttendance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Attendance recorded successfully", record, 201);
  } catch (error) {
    next(error);
  }
};

export const getAttendance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // `attendance.view` also drives self-service nav visibility, so plain
    // Employees hold it too — without this, the unscoped list would leak
    // every employee's check-in/out times to them. Only managers/Super Admin
    // get the org-wide view; everyone else is pinned to their own records.
    const query = { ...(req.query as Record<string, string>) };
    if (!canManage(req)) query.user = req.user!.userId;
    const { records, pagination } = await service.list(query);
    sendSuccess(res, "Attendance retrieved successfully", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getAttendanceCalendar = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) { sendError(res, "month (YYYY-MM) is required", 400); return; }

    let employee = req.query.employee ? String(req.query.employee) : undefined;
    if (!canManage(req)) {
      const own = await Employee.findOne(scoped({ user: req.user!.userId })).select("_id");
      // No linked Employee record → an id that can never match, so the
      // calendar comes back empty instead of silently falling through to
      // the unscoped (whole-org) query.
      employee = own ? String(own._id) : "000000000000000000000000";
    }
    sendSuccess(res, "Attendance calendar", await service.calendar(month, employee));
  } catch (error) { next(error); }
};

export const getAttendanceDaily = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const date = String(req.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { sendError(res, "date (YYYY-MM-DD) is required", 400); return; }

    // Same scoping as the calendar: this view shows everybody's check-in times,
    // so somebody without the manager flag only ever sees their own row.
    let employee = req.query.employee ? String(req.query.employee) : undefined;
    if (!canManage(req)) {
      const own = await Employee.findOne(scoped({ user: req.user!.userId })).select("_id");
      employee = own ? String(own._id) : "000000000000000000000000";
    }
    sendSuccess(res, "Daily attendance", await service.daily(date, employee));
  } catch (error) { next(error); }
};

export const getAttendanceById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.getById(req.params.id);
    sendSuccess(res, "Attendance retrieved successfully", record);
  } catch (error) {
    next(error);
  }
};

export const updateAttendance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Attendance updated successfully", record);
  } catch (error) {
    next(error);
  }
};

export const deleteAttendance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};

// ── Self-service ──
export const bulkSetAttendanceStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ids, status } = req.body as { ids?: string[]; status?: string };
    if (!Array.isArray(ids) || !ids.length) {
      throw Object.assign(new Error("Select at least one record"), { statusCode: 400 });
    }
    if (!status) throw Object.assign(new Error("A status is required"), { statusCode: 400 });
    const result = await service.setStatusMany(ids, status);
    sendSuccess(res, `${result.modified} record${result.modified === 1 ? "" : "s"} updated`, result);
  } catch (error) {
    next(error);
  }
};

export const getTodayAttendance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.getToday(req.user!.userId);
    sendSuccess(res, "Today's attendance", result);
  } catch (error) {
    next(error);
  }
};

export const getMyAttendance = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your attendance", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * The provenance of a self-service punch.
 *
 * A bad body is ignored rather than refused: the location is a detail attached
 * to the punch, and failing somebody's check-in because their browser sent an
 * odd accuracy value would lose the thing that actually matters.
 */
const webSource = (req: AuthenticatedRequest) => {
  const parsed = punchContextSchema.safeParse(req.body ?? {});
  const body = parsed.success ? parsed.data : undefined;
  return {
    method: "web" as const,
    ...buildPunchContext(req, body),
    // Passed straight through rather than derived: these identify the browser
    // rather than describe the punch, and the service strips them again.
    deviceKey: body?.deviceKey,
    deviceFingerprint: body?.deviceFingerprint,
    deviceLabel: body?.deviceLabel,
  };
};

export const clockIn = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.clockIn(req.user!.userId, webSource(req));
    sendSuccess(res, "Clocked in", record, 201);
  } catch (error) {
    next(error);
  }
};

export const clockOut = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.clockOut(req.user!.userId, webSource(req));
    sendSuccess(res, "Clocked out", record);
  } catch (error) {
    next(error);
  }
};
