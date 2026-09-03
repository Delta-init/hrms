import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AttendanceService } from "../services/attendanceService.js";
import { createAttendanceSchema, updateAttendanceSchema, punchContextSchema } from "../validations/attendanceValidation.js";
import { buildPunchContext } from "../utils/punchContext.js";
import { reverseGeocode } from "../utils/reverseGeocode.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { Employee } from "../models/Employee.js";
import { scoped } from "../utils/orgContext.js";

const service = new AttendanceService();

function canManage(req: AuthenticatedRequest): boolean {
  return !!req.user?.role?.permissions?.attendance?.edit || req.user?.role?.roleName === "Super Admin";
}

/**
 * Where a punch came from, and who is allowed to know.
 *
 * An IP address, a browser fingerprint and a street address are the provenance
 * of a punch, not the punch itself. They exist so somebody investigating an odd
 * day can tell a forgotten clock-out from a punch made from somewhere it should
 * not have been — which is a question for whoever manages attendance, and for
 * nobody else, including the person the record is about.
 *
 * Showing somebody their own is not harmless either. An IP the database itself
 * rates as accurate to 200km reads as a claim about where they were, and the
 * first thing it produces is an argument about a city they were never in.
 */
const ORIGIN_FIELDS = [
  "punchDevice", "punchIp", "punchPlace", "punchAddress", "punchAddressFull", "punchCoords",
  "punchLocationSource", "punchMethod", "punchOutDevice", "punchOutIp", "punchOutAddress",
  "punchOutAddressFull", "punchOutCoords", "punchDiffers", "punchMovedMetres",
  "deviceAnomaly", "deviceLabel",
] as const;

/**
 * Strip the provenance from one record, raw sessions included.
 *
 * The sessions are the part that is easy to forget: the list flattens a summary
 * onto each row, but the rows still carry the sessions the summary was built
 * from, so removing the summary alone would hide the columns while leaving
 * every value one level down in the same response.
 */
function redactOrigin<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of ORIGIN_FIELDS) delete out[f];

  const sessions = out.sessions;
  if (Array.isArray(sessions)) {
    out.sessions = sessions.map((sn) => {
      if (!sn || typeof sn !== "object") return sn;
      // Keep the times — those are the record. Drop what surrounds them.
      const { checkInSource: _in, checkOutSource: _out, ...rest } = sn as Record<string, unknown>;
      return rest;
    });
  }
  return out as T;
}

/** The same, for a page of them, applied only where it is not the reader's to see. */
const redactUnlessManager = <T extends Record<string, unknown>>(req: AuthenticatedRequest, rows: T[]): T[] =>
  canManage(req) ? rows : rows.map(redactOrigin);

/**
 * The calendar and the day view carry the same provenance in a different shape.
 *
 * They are built from `anomalyOf`, not from the flattened summary, so the field
 * list above does not reach them — a redaction that only knew about the list
 * would leave "this was not their device" on every calendar cell.
 */
function redactCalendar(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = payload as { employees?: unknown };
  if (!Array.isArray(p.employees)) return payload;
  const strip = (d: unknown) => {
    if (!d || typeof d !== "object") return d;
    const { deviceAnomaly: _a, deviceLabel: _l, ...rest } = d as Record<string, unknown>;
    return rest;
  };
  return {
    ...(payload as Record<string, unknown>),
    employees: p.employees.map((e) => {
      if (!e || typeof e !== "object") return e;
      const row = e as Record<string, unknown>;
      // The calendar nests a map of days; the day view spreads one day onto the
      // row itself. Both shapes come through here.
      const days = row.days && typeof row.days === "object"
        ? Object.fromEntries(Object.entries(row.days as Record<string, unknown>).map(([k, v]) => [k, strip(v)]))
        : row.days;
      return { ...(strip(row) as Record<string, unknown>), ...(days ? { days } : {}) };
    }),
  };
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
    sendSuccess(res, "Attendance retrieved successfully", redactUnlessManager(req, records), 200, pagination);
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
    const calendar = await service.calendar(month, employee);
    sendSuccess(res, "Attendance calendar", canManage(req) ? calendar : redactCalendar(calendar));
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
    const daily = await service.daily(date, employee);
    sendSuccess(res, "Daily attendance", canManage(req) ? daily : redactCalendar(daily));
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
    // Redacted for the person it is about too — see redactOrigin. Their own IP
    // is not something they need, and it is wrong often enough to start rows.
    sendSuccess(res, "Your attendance", redactUnlessManager(req, records), 200, pagination);
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
const webSource = async (req: AuthenticatedRequest) => {
  const parsed = punchContextSchema.safeParse(req.body ?? {});
  const body = parsed.success ? parsed.data : undefined;
  const ctx = buildPunchContext(req, body);

  /**
   * The address, where there is a coordinate to resolve.
   *
   * Awaited rather than left to finish later: the punch is written once, and a
   * lookup that lands after it has nowhere to go. It is bounded to a few
   * seconds and every failure returns nothing, so the worst case is a record
   * with coordinates and no street — which is what every record had until now.
   */
  const place =
    typeof ctx.latitude === "number" && typeof ctx.longitude === "number"
      ? await reverseGeocode(ctx.latitude, ctx.longitude)
      : null;

  return {
    method: "web" as const,
    ...ctx,
    // Only where the lookup answered. The city and country from the IP are
    // already on the context and are a far coarser guess; a real address
    // overrides them rather than sitting beside them contradicting.
    ...(place
      ? {
          road: place.road ?? null,
          suburb: place.suburb ?? null,
          district: place.district ?? null,
          postcode: place.postcode ?? null,
          addressLabel: place.label ?? null,
          city: place.city ?? ctx.city,
          region: place.state ?? ctx.region,
          country: place.countryCode ?? ctx.country,
        }
      : {}),
    // Passed straight through rather than derived: these identify the browser
    // rather than describe the punch, and the service strips them again.
    deviceKey: body?.deviceKey,
    deviceFingerprint: body?.deviceFingerprint,
    deviceLabel: body?.deviceLabel,
  };
};

export const clockIn = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.clockIn(req.user!.userId, await webSource(req));
    sendSuccess(res, "Clocked in", record, 201);
  } catch (error) {
    next(error);
  }
};

export const clockOut = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.clockOut(req.user!.userId, await webSource(req));
    sendSuccess(res, "Clocked out", record);
  } catch (error) {
    next(error);
  }
};
