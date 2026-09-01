import { createHash, timingSafeEqual } from "node:crypto";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Holiday } from "../models/Holiday.js";
import { Organization } from "../models/Organization.js";
import { leavePolicyIndex, leaveLabel } from "./leavePolicyResolver.js";
import { employmentWindows, employedOn } from "./employmentWindow.js";
import type { CreateAttendanceInput, UpdateAttendanceInput } from "../validations/attendanceValidation.js";
import type { IPunchSource, ITrustedDevice, RemoteDevicePolicy, DeviceAnomaly, PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { resolveShift, statusForClockIn, DEFAULT_SCHEDULE, type ShiftSchedule, DEFAULT_WORK_DAYS, localDayKey, todayInTz, zonedTimeToUtc } from "../utils/schedule.js";
import { resolveWorkScheduleForUser, rosterWorkDaysByUser, workDaysForDate } from "./workScheduleService.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination, searchRegex } from "../utils/query.js";
import { Types } from "mongoose";

/**
 * The one device flag a day carries.
 *
 * A punch records where it came from, and either end of a session can look
 * wrong. A day with two odd punches is not twice as odd — somebody still has
 * to look at it exactly once — so the first flag found stands for the day.
 */
type Sourced = { deviceAnomaly?: DeviceAnomaly | null; deviceLabel?: string | null } | null;
type SourcedSession = { checkInSource?: Sourced; checkOutSource?: Sourced };

/**
 * The flagged punch of a day, and the machine it came from.
 *
 * The label matters as much as the flag: "this was not their device" is a
 * question, and "this was not their device — it came from Chrome on Windows"
 * is something somebody can act on without opening the record. The first flag
 * found stands for the day, because a day with two odd punches is not twice as
 * odd; somebody still has to look at it exactly once.
 */
function anomalyOf(sessions?: unknown): { deviceAnomaly: DeviceAnomaly | null; deviceLabel: string | null } {
  const list = (sessions ?? []) as SourcedSession[];
  const flagged = list
    .flatMap((x) => [x?.checkInSource, x?.checkOutSource])
    .find((src) => src?.deviceAnomaly);
  return {
    deviceAnomaly: flagged?.deviceAnomaly ?? null,
    // Only the flagged punch's device is named. The label on an ordinary punch
    // is the device they are supposed to be on, and putting that on the row
    // would read as an accusation about the wrong machine.
    deviceLabel: flagged?.deviceLabel?.trim() || null,
  };
}

/**
 * A YYYY-MM-DD range as a plain string comparison.
 *
 * The keys sort lexicographically in date order, so `$gte`/`$lte` on the string
 * is the range — and it needs no timezone, which is the whole point: there is
 * no one zone that is right for everybody being listed. Anything that is
 * already an instant is reduced to the day it names.
 */
function dayRange(from?: string, to?: string): Record<string, string> {
  const key = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString().slice(0, 10));
  const r: Record<string, string> = {};
  if (from) r.$gte = key(from);
  if (to) r.$lte = key(to);
  return r;
}

/**
 * Provenance passed in by whoever recorded the punch.
 *
 * `deviceKey` and `deviceFingerprint` are transient: they identify the browser
 * and are stripped in `gatePunch` before anything is written. The key is the
 * secret that stands for the device — storing a copy on every punch would
 * scatter it across the attendance history.
 */
export type PunchSource = Omit<IPunchSource, "kiosk"> & {
  kiosk?: string | null;
  deviceKey?: string;
  deviceFingerprint?: string;
};

interface AttendanceQuery extends PaginationQuery {
  user?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Name, employee code or email of the person a row belongs to. */
  search?: string;
}


export class AttendanceService {
  private applySessions(doc: { checkIn?: Date | null; checkOut?: Date | null; sessions: unknown }, checkIn?: Date | null, checkOut?: Date | null) {
    // Build a single session from top-level check-in/out so worked minutes compute.
    if (checkIn) {
      doc.sessions = [{ checkIn, checkOut: checkOut ?? null }] as never;
    } else {
      doc.sessions = [] as never;
    }
  }

  /**
   * The day a record belongs to, in the only terms that find it again.
   *
   * A record is looked up by an exact `date`, and that instant is midnight in
   * the person's own timezone — that is what clockIn writes and what the
   * employee's own screen asks for. Recording attendance by hand used to store
   * the bare calendar date instead, which is midnight UTC: five and a half
   * hours away for somebody on Asia/Kolkata. The record existed, the admin
   * table listed it, and the employee's dashboard still said "not clocked in",
   * because it was filed under a key nothing else looks at.
   */
  private async dayKeyFor(userId: string, date: Date): Promise<{ key: Date; timeZone: string }> {
    const schedule = await this.scheduleFor(userId);
    // Anchored at noon UTC so the calendar date the admin picked survives the
    // shift into the target zone in either direction.
    const noon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
    const shift = resolveShift(schedule, noon);
    return { key: shift.dateMidnightUtc, timeZone: schedule.timeZone };
  }

  async create(input: CreateAttendanceInput) {
    // Scope the user to the caller's org so a record can't reference another tenant's user.
    const user = await User.findOne(scoped({ _id: input.user }));
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    const { key, timeZone } = await this.dayKeyFor(String(input.user), input.date);

    // A day already recorded — whether by hand or by the person clocking in —
    // is amended rather than duplicated. Two records for one day would be
    // counted twice by every total that follows, pay included, and the old
    // guard could not see a clock-in at all because it compared the raw date.
    const existing = await Attendance.findOne(scoped({ user: input.user, date: key }));
    if (existing) {
      existing.timeZone = input.timeZone ?? timeZone;
      existing.status = input.status;
      existing.lateMinutes = input.lateMinutes ?? 0;
      if (input.note !== undefined) existing.note = input.note;
      if (input.checkIn !== undefined || input.checkOut !== undefined) {
        this.applySessions(existing, input.checkIn ?? existing.checkIn, input.checkOut ?? existing.checkOut);
      }
      await existing.save();
      return Attendance.findById(existing._id).populate("user", "name email designation");
    }

    const attendance = new Attendance({
      organization: getOrgId(),
      user: input.user,
      date: key,
      // Falls back to the person's own schedule rather than a fixed zone: the
      // list renders each record's times in whatever this says.
      timeZone: input.timeZone ?? timeZone,
      status: input.status,
      lateMinutes: input.lateMinutes ?? 0,
      note: input.note,
    });
    this.applySessions(attendance, input.checkIn, input.checkOut);
    await attendance.save();
    return Attendance.findById(attendance._id).populate("user", "name email designation");
  }

  /** The organization's timezone — what "a day" means for this tenant. */
  private async orgTimeZone(): Promise<string> {
    const org = await Organization.findById(getOrgId()).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>();
    return org?.settings?.timeZone || DEFAULT_SCHEDULE.timeZone;
  }

  async list(query: AttendanceQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;

    /**
     * Search by the person, not by the row.
     *
     * An attendance record holds only a reference to the login, so there is no
     * name on it to match. The people are resolved first and the rows narrowed
     * to them — as a constraint on the query rather than a filter over the
     * page, so a search cannot return four of nine matches because the other
     * five happened to fall on page two.
     *
     * The employee code is searchable too, and lives on the employee record
     * rather than the login, so both are asked.
     */
    if (query.search?.trim()) {
      const rx = searchRegex(query.search.trim());
      const [users, employees] = await Promise.all([
        User.find({ ...orgFilter(), $or: [{ name: rx }, { email: rx }] }).select("_id").lean(),
        Employee.find({ ...orgFilter(), $or: [{ name: rx }, { employeeCode: rx }] }).select("user").lean(),
      ]);
      const ids = new Set([
        ...users.map((u) => String(u._id)),
        ...employees.map((e) => e.user).filter(Boolean).map(String),
      ]);
      // A search matching nobody must return nothing, not everybody.
      filter.user = query.user && ids.has(String(query.user))
        ? query.user
        : { $in: [...ids].map((id) => new Types.ObjectId(id)) };
    }
    if (query.dateFrom || query.dateTo) {
      // Matched on the day the record is written under, not on a range of
      // instants. A range has to be anchored in one timezone, and every person
      // outside it falls the wrong side of the edge: an Asia/Kolkata day starts
      // ninety minutes before an Asia/Dubai one, so asking for today returned
      // the Dubai staff, dropped all thirty on Kolkata time, and quietly
      // included their records for tomorrow instead.
      filter.localDay = dayRange(query.dateFrom, query.dateTo);
    }

    const sortable = new Set(["date", "workedMinutes", "lateMinutes", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "date";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [found, total] = await Promise.all([
      Attendance.find(filter)
        .populate("user", "name email designation")
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(filter),
    ]);

    // Flattened by the same rule the day view uses: the same punch was flagged
    // on one tab and clean on the other, which is worse than not flagging it at
    // all. The rows still carry their raw sessions — this only adds the summary
    // the list actually reads.
    const records = found.map((r) => ({ ...r, ...anomalyOf(r.sessions) }));

    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Attendance.findOne(scoped({ _id: id })).populate("user", "name email designation");
    if (!record) throw Object.assign(new Error("Attendance record not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateAttendanceInput) {
    const record = await Attendance.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Attendance record not found"), { statusCode: 404 });

    if (input.date !== undefined) {
      // Through the same rule as create, so editing a record's date cannot
      // file it where its owner will not find it.
      const { key } = await this.dayKeyFor(String(record.user), input.date);
      const clash = await Attendance.findOne(scoped({ user: record.user, date: key, _id: { $ne: record._id } }));
      if (clash) {
        throw Object.assign(
          new Error("This user already has a record on that day"),
          { statusCode: 409 }
        );
      }
      record.date = key;
    }
    if (input.timeZone !== undefined) record.timeZone = input.timeZone;
    if (input.status !== undefined) record.status = input.status;
    if (input.lateMinutes !== undefined) record.lateMinutes = input.lateMinutes;
    if (input.note !== undefined) record.note = input.note ?? undefined;

    // Rebuild sessions when either check time is supplied in the update.
    if (input.checkIn !== undefined || input.checkOut !== undefined) {
      const checkIn = input.checkIn !== undefined ? input.checkIn : record.checkIn;
      const checkOut = input.checkOut !== undefined ? input.checkOut : record.checkOut;
      this.applySessions(record, checkIn, checkOut);
    }

    await record.save();
    return Attendance.findById(id).populate("user", "name email designation");
  }

  /**
   * Set the status on several days at once.
   *
   * Marking a room full of people on leave, or correcting a run of days a rule
   * got wrong, was one record at a time through a dialog. The late minutes go
   * with the status: a day called present that still carries eighty of them
   * contradicts itself, and that is exactly the state hand-editing one field at
   * a time kept producing.
   *
   * Scoped and counted rather than trusted: ids are matched inside the caller's
   * organisation, and the number actually changed is reported, so a request
   * naming another tenant's record silently changes nothing and says so.
   */
  async setStatusMany(ids: string[], status: string) {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (!valid.length) return { matched: 0, modified: 0 };
    const update: Record<string, unknown> = { status };
    // Only a late or half day carries late minutes; anything else keeps them
    // at zero rather than inheriting a number from the status it used to be.
    if (status !== "late" && status !== "half_day") update.lateMinutes = 0;
    const res = await Attendance.updateMany(scoped({ _id: { $in: valid } }), { $set: update });
    return { matched: res.matchedCount, modified: res.modifiedCount };
  }

  async remove(id: string) {
    const record = await Attendance.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Attendance record not found"), { statusCode: 404 });
    return { message: "Attendance record deleted successfully" };
  }

  // ── Self-service clock-in / clock-out ──────────────────────────────────────

  private async scheduleFor(userId: string): Promise<ShiftSchedule> {
    const ws = await resolveWorkScheduleForUser(userId, new Date());
    if (ws && ws.timeZone) {
      return { timeZone: ws.timeZone, loginTime: ws.loginTime, logoutTime: ws.logoutTime, graceMinutes: ws.graceMinutes ?? 15 };
    }
    return DEFAULT_SCHEDULE;
  }

  /**
   * Whether this person may punch from the web app.
   *
   * Office staff are expected at a kiosk, because being on site is the thing
   * the punch attests to and one made from a phone on the way in attests to
   * nothing. Work-from-home staff have no kiosk to walk past, so the web app is
   * the only place they can punch at all.
   *
   * Three separate ways to be allowed, and each is there for a reason:
   *  - the organization has not turned the policy on;
   *  - the person works from home;
   *  - or no employee record stands behind the login. Admin and service
   *    accounts are not who the policy describes, and locking them out of their
   *    own attendance while enforcing a rule about office attendance would be
   *    an accident rather than a decision.
   */
  private async selfPunchPolicy(userId: string): Promise<{
    workMode: "office" | "wfh" | null;
    enforced: boolean;
    canSelfPunch: boolean;
    devicePolicy: RemoteDevicePolicy;
    employeeId: string | null;
    trustedDevice: ITrustedDevice | null;
  }> {
    const [org, employee] = await Promise.all([
      Organization.findById(getOrgId())
        .select("settings.enforceWorkMode settings.remoteDevice")
        .lean<{ settings?: { enforceWorkMode?: boolean; remoteDevice?: RemoteDevicePolicy } } | null>(),
      Employee.findOne(scoped({ user: userId }))
        .select("workMode trustedDevice")
        .lean<{ _id: unknown; workMode?: "office" | "wfh"; trustedDevice?: ITrustedDevice | null } | null>(),
    ]);

    const enforced = !!org?.settings?.enforceWorkMode;
    // Records written before the field existed have none: Mongoose only applies
    // a default when a document is saved. Absent means office, which is what
    // everybody was before anyone could choose otherwise.
    const workMode = employee ? employee.workMode ?? "office" : null;

    return {
      workMode,
      enforced,
      canSelfPunch: !enforced || workMode !== "office",
      // Only remote staff are held to one browser. Office staff punch at a
      // kiosk, which already knows exactly which device it is.
      devicePolicy: workMode === "wfh" ? org?.settings?.remoteDevice ?? "off" : "off",
      employeeId: employee ? String(employee._id) : null,
      trustedDevice: employee?.trustedDevice ?? null,
    };
  }

  /**
   * Hold a remote employee to the one browser they registered.
   *
   * The browser mints a random key on first use and keeps it; we store only its
   * hash, and every later punch has to present the same key. That is as close
   * to "one device" as a web app gets — a determined person can copy the key
   * out of their own browser, and no amount of fingerprinting changes that.
   * What it does buy is that using a second device takes deliberate effort and
   * leaves a trail, rather than being the path of least resistance.
   *
   * Returns what to stamp on the punch, or null when the rule does not apply.
   */
  private async bindOrCheckDevice(
    policy: { devicePolicy: RemoteDevicePolicy; employeeId: string | null; trustedDevice: ITrustedDevice | null },
    source: PunchSource | undefined
  ): Promise<{ deviceLabel: string | null; deviceAnomaly: DeviceAnomaly | null } | null> {
    // A kiosk punch is identified by the kiosk, and a manual one by the admin
    // making it. Neither is a browser this rule has anything to say about.
    if (source && source.method !== "web") return null;
    if (policy.devicePolicy === "off" || !policy.employeeId) return null;

    const enforcing = policy.devicePolicy === "enforce";
    /** Refuse when enforcing, otherwise let it through carrying the reason. */
    const refuseOrFlag = (anomaly: DeviceAnomaly, message: string, code: string) => {
      if (enforcing) throw Object.assign(new Error(message), { statusCode: 403, code });
      return { deviceLabel: source?.deviceLabel?.trim().slice(0, 80) || null, deviceAnomaly: anomaly };
    };

    const key = source?.deviceKey?.trim();
    if (!key) {
      // Private browsing, cleared storage, or a client too old to send one.
      return refuseOrFlag(
        "no_device",
        "This browser can't identify itself. Allow site data and try again, or ask HR to reset your device.",
        "DEVICE_KEY_MISSING"
      );
    }

    const hash = createHash("sha256").update(key).digest("hex");
    const label = source?.deviceLabel?.trim().slice(0, 80) || "Unnamed device";
    const fingerprint = source?.deviceFingerprint?.trim().slice(0, 64) || "";
    const known = policy.trustedDevice;

    if (!known?.keyHash) {
      // First punch registers the device. Pre-registration by HR was the
      // alternative and it makes every new joiner wait on an admin before they
      // can start their first day; when and from where is kept instead, which
      // is what makes this auditable afterwards.
      await Employee.updateOne(
        { _id: policy.employeeId },
        {
          $set: {
            trustedDevice: {
              keyHash: hash,
              label,
              fingerprint,
              boundAt: new Date(),
              boundIp: source?.ip ?? "",
              lastSeenAt: new Date(),
            },
          },
        }
      );
      return { deviceLabel: label, deviceAnomaly: null };
    }

    // Constant-time, so the comparison cannot be probed a byte at a time.
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(known.keyHash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      // Not re-registered when only flagging: the device they are supposed to
      // be on stays the reference, or the second punch from the wrong machine
      // would look correct and the anomaly would erase itself.
      return refuseOrFlag(
        "unknown_device",
        `Attendance is tied to your registered device (${known.label || "unnamed"}). Punch from it, or ask HR to reset it.`,
        "DEVICE_NOT_TRUSTED"
      );
    }

    // Same key, different-looking machine. Not refused — a browser update
    // rewrites its own user agent and nobody should lose a day's pay to that —
    // but recorded on the punch so it can be looked at.
    const changed = !!fingerprint && !!known.fingerprint && fingerprint !== known.fingerprint;
    await Employee.updateOne(
      { _id: policy.employeeId },
      { $set: { "trustedDevice.lastSeenAt": new Date(), "trustedDevice.fingerprint": fingerprint || known.fingerprint } }
    );
    return { deviceLabel: known.label || label, deviceAnomaly: changed ? "changed_device" : null };
  }

  /**
   * Refuse a web punch from somebody the kiosk policy covers.
   *
   * Enforced here rather than on the route so that a hand-written POST is
   * refused too. Hiding the button is a courtesy; this is the rule.
   */
  private assertKioskRule(policy: { canSelfPunch: boolean }, source?: PunchSource) {
    // Only the employee's own web punch is covered. A kiosk punch is the very
    // thing the policy asks for, and a manual one is an administrator acting —
    // neither is somebody dodging the walk to the lobby.
    if (source && source.method !== "web") return;
    if (policy.canSelfPunch) return;

    throw Object.assign(new Error("Please check in at the kiosk — dashboard check-in is for remote staff"), {
      statusCode: 403,
      code: "KIOSK_ONLY",
    });
  }

  /**
   * Every rule a punch has to pass, and the provenance to store once it has.
   *
   * One place and one policy read, so the two rules cannot disagree about who
   * somebody is: which device is allowed depends on the same work mode that
   * decides whether they may punch here at all.
   */
  private async gatePunch(
    userId: string,
    source: PunchSource | undefined,
    opts?: { skipKioskRule?: boolean }
  ): Promise<PunchSource | undefined> {
    const policy = await this.selfPunchPolicy(userId);
    if (!opts?.skipKioskRule) this.assertKioskRule(policy, source);

    const device = await this.bindOrCheckDevice(policy, source);
    // Drop the secret before it can reach a document, whether or not the rule
    // applied — nothing downstream has any use for it.
    const { deviceKey: _k, deviceFingerprint: _f, ...rest } = source ?? { method: "web" as const };
    return device ? { ...rest, ...device } : (source ? rest : undefined);
  }

  /** Mark any of the user's prior open days (clocked in, never out) as half-day. */
  private async closeStaleDays(userId: string, todayMidnightUtc: Date) {
    await Attendance.updateMany(
      { user: userId, date: { $lt: todayMidnightUtc }, checkIn: { $ne: null }, checkOut: null, status: { $in: ["present", "late"] } },
      { $set: { status: "half_day" } }
    );
  }

  async getToday(userId: string) {
    const schedule = await this.scheduleFor(userId);
    const shift = resolveShift(schedule, new Date());
    await this.closeStaleDays(userId, shift.dateMidnightUtc);
    const [attendance, policy] = await Promise.all([
      Attendance.findOne({ user: userId, date: shift.dateMidnightUtc }).lean(),
      this.selfPunchPolicy(userId),
    ]);

    // Somebody the policy refuses may still close a session they opened from
    // here, so the card is told about that separately rather than being locked
    // outright — see clockOut.
    const open = attendance?.sessions?.[attendance.sessions.length - 1];
    const canFinishOpenSession =
      !!attendance?.checkIn && !attendance.checkOut &&
      (!open?.checkInSource || open.checkInSource.method === "web");

    return {
      attendance,
      schedule,
      punchPolicy: {
        workMode: policy.workMode,
        canSelfPunch: policy.canSelfPunch,
        canFinishOpenSession,
        device: {
          policy: policy.devicePolicy,
          registered: !!policy.trustedDevice?.keyHash,
          label: policy.trustedDevice?.label ?? null,
        },
      },
      shift: {
        shiftStart: shift.shiftStart,
        shiftEnd: shift.shiftEnd,
        windowOpen: shift.windowOpen,
        lateThreshold: shift.lateThreshold,
        halfDayThreshold: shift.halfDayThreshold,
        serverNow: new Date(),
      },
    };
  }

  async listMine(userId: string, query: PaginationQuery & { dateFrom?: string; dateTo?: string }) {
    return this.list({ ...query, user: userId } as never);
  }

  /**
   * Record a login.
   *
   * `source` says how the punch was made; omitting it means the web app, which
   * is what every punch was before the kiosk existed.
   */
  async clockIn(userId: string, source?: PunchSource) {
    // Checked before anything else: "you cannot clock in here at all" outranks
    // "not yet", and telling somebody to wait for a window they may never use
    // would send them back at nine to be refused again.
    source = await this.gatePunch(userId, source);

    const schedule = await this.scheduleFor(userId);
    const shift = resolveShift(schedule, new Date());
    const now = new Date();

    if (now.getTime() < shift.windowOpen.getTime()) {
      throw Object.assign(new Error("Clock-in is not open yet"), { statusCode: 400, code: "TOO_EARLY", windowOpen: shift.windowOpen });
    }

    await this.closeStaleDays(userId, shift.dateMidnightUtc);
    let att = await Attendance.findOne({ user: userId, date: shift.dateMidnightUtc });
    if (att && att.checkIn) {
      throw Object.assign(new Error("You have already clocked in today"), { statusCode: 409 });
    }

    const status = statusForClockIn(now, shift);
    // On-time within grace = not late; only count minutes when actually late.
    const lateMinutes = status === "present" ? 0 : Math.max(0, Math.round((now.getTime() - shift.shiftStart.getTime()) / 60000));

    if (!att) att = new Attendance({ organization: getOrgId(), user: userId, date: shift.dateMidnightUtc, timeZone: schedule.timeZone });
    att.timeZone = schedule.timeZone;
    att.status = status;
    att.lateMinutes = lateMinutes;
    att.sessions = [{ checkIn: now, checkOut: null, checkInSource: source ?? null }] as never;
    await att.save();
    return Attendance.findById(att._id).populate("user", "name email designation");
  }

  async clockOut(userId: string, source?: PunchSource) {
    const now = new Date();

    // Close the latest still-open session (checked in, not yet out) rather than
    // only "today" — an overnight shift clocks out on the next calendar day.
    // Bounded to the last 2 days so a forgotten open day isn't closed here.
    const cutoff = new Date(now.getTime() - 2 * 86_400_000);
    const att = await Attendance.findOne({
      user: userId, checkIn: { $ne: null }, checkOut: null, date: { $gte: cutoff },
    }).sort({ date: -1 });
    if (!att) {
      throw Object.assign(new Error("You haven't clocked in, or already clocked out"), { statusCode: 400 });
    }

    const open = att.sessions[att.sessions.length - 1];
    // Anybody may close a session they opened here, even once the policy would
    // refuse them a new one. Turning enforcement on at two in the afternoon
    // otherwise strands everybody who clocked in from their desk that morning:
    // no way to clock out, and an open day that becomes a half-day overnight.
    // A punch made at the kiosk is still closed at the kiosk.
    const startedHere = !open?.checkInSource || open.checkInSource.method === "web";
    // The device rule still applies either way: finishing a day you started is
    // a concession about where you are, not about whose machine you are on.
    source = await this.gatePunch(userId, source, { skipKioskRule: startedHere });

    if (att.sessions.length > 0) {
      const last = att.sessions[att.sessions.length - 1]!;
      last.checkOut = now;
      last.checkOutSource = (source ?? null) as never;
    } else {
      att.sessions = [{ checkIn: att.checkIn!, checkOut: now, checkOutSource: source ?? null }] as never;
    }
    await att.save();
    return Attendance.findById(att._id).populate("user", "name email designation");
  }

  /**
   * Month attendance calendar for one employee or the whole org. Returns a
   * compact per-employee day-map (status + times), overlaying approved leave,
   * holidays, weekends (from the work schedule) and absent (past working days
   * with no record). One record per employee-day drives the calendar UI.
   */
  async calendar(month: string, employeeId?: string) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const year = start.getUTCFullYear();
    const monthIndex = start.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    // Attendance stores a day as its local midnight in UTC, so the first day of
    // the month sits before this window and the first of the next month sits
    // inside it. Widen by a day at each end and let the local-day key below
    // decide what actually belongs to the month — that works whatever timezone
    // each person's schedule is in, without picking one for the whole query.
    const DAY = 86_400_000;
    const scanStart = new Date(start.getTime() - DAY);
    const scanEnd = new Date(end.getTime() + DAY);

    // Whose "today" it is depends on where the organization is, not on UTC.
    // This decides whether a blank past day is drawn as absent, so in the hours
    // either side of midnight the UTC date marks the wrong day.
    const orgTz = await this.orgTimeZone();
    const todayKey = todayInTz(orgTz);
    // Loaded once for the whole month rather than per employee — a calendar
    // walks everybody, and a query each would turn one page into dozens.
    const policyIndex = await leavePolicyIndex();

    const empFilter: Record<string, unknown> = { ...orgFilter(), user: { $ne: null } };
    if (employeeId) empFilter._id = employeeId;
    const employees = await Employee.find(empFilter)
      .select("name employeeCode designation user joiningDate")
      .populate({ path: "user", select: "workSchedule", populate: { path: "workSchedule", select: "workDays timeZone" } })
      .sort({ name: 1 })
      .lean();

    const userIds = employees.map((e) => (e.user as { _id?: unknown } | null)?._id).filter(Boolean);
    // Days before somebody joined, or after their last working day, are not
    // theirs to account for. Without this a mid-month joiner was marked absent
    // for every working day before they existed as an employee.
    const windows = await employmentWindows(employees as never);


    const [att, monthLeaves, holidays, rosterMap, regs] = await Promise.all([
      Attendance.find({ user: { $in: userIds }, date: { $gte: scanStart, $lt: scanEnd } })
        .select("user date status workedMinutes checkIn checkOut lateMinutes note timeZone " +
                // Only the verdict, not the whole provenance: a month of full
                // punch sources for every employee is a large payload to carry
                // in order to draw one dot.
                "sessions.checkInSource.deviceAnomaly sessions.checkOutSource.deviceAnomaly").lean(),
      LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lt: end }, endDate: { $gte: start } })
        .select("user startDate endDate type halfDay").lean(),
      Holiday.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("date name").lean(),
      rosterWorkDaysByUser(userIds.map((id) => String(id)), start, end),
      // Corrections in flight or already applied. Shown on the day they concern
      // so a disputed day is visible as disputed, rather than looking settled.
      Regularization.find({ user: { $in: userIds }, status: { $in: ["pending", "approved"] }, date: { $gte: start, $lt: end } })
        .select("user date type status resultingStatus").lean(),
    ]);

    type DayLeave = { type: string; label: string; paid: boolean };
    type DayReg = { _id: unknown; type: string; status: string; resultingStatus?: string };
    type DayEntry = {
      /**
       * The attendance record behind the day, where one exists.
       *
       * A day view row is a person, not a record — most of them have no record
       * at all — so editing or deleting one needs the id of the thing being
       * acted on. Absent means there is nothing to act on, which is a different
       * state from a record that says "absent".
       */
      attendanceId?: string;
      status: string; workedMinutes?: number; checkIn?: Date | null; checkOut?: Date | null;
      lateMinutes?: number; note?: string; timeZone?: string | null;
      /** Set when any punch that day came from somewhere other than the
       *  registered device — the day is marked for review, not disputed. */
      deviceAnomaly?: DeviceAnomaly | null;
      /** The machine that flagged punch came from, so the row can name it. */
      deviceLabel?: string | null;
      /** Approved leave covering this day, whatever the attendance says. */
      leave?: DayLeave;
      /** A correction raised for this day. */
      regularization?: DayReg;
    };
    const attByUser = new Map<string, Record<string, DayEntry>>();
    for (const a of att) {
      const uid = String(a.user);
      // Read the day back in the timezone it was written for. The record
      // carries its own; fall back to the org's for rows written before that
      // field existed. Days either side of the month simply never match a key.
      const key = localDayKey(a.date, a.timeZone || orgTz);
      if (!attByUser.has(uid)) attByUser.set(uid, {});
      attByUser.get(uid)![key] = {
        attendanceId: String(a._id),
        status: a.status as string, workedMinutes: a.workedMinutes ?? 0,
        checkIn: a.checkIn ?? null, checkOut: a.checkOut ?? null,
        lateMinutes: a.lateMinutes ?? 0, note: a.note ?? "", timeZone: a.timeZone ?? null,
        ...anomalyOf(a.sessions),
      };
    }
    // Per user, the leave in force on each day — "wfh" paints the calendar
    // distinctly from actual leave (on_leave).
    const leaveDaysByUser = new Map<string, Map<string, string>>();
    for (const l of monthLeaves) {
      const uid = String(l.user);
      if (!leaveDaysByUser.has(uid)) leaveDaysByUser.set(uid, new Map());
      const map = leaveDaysByUser.get(uid)!;
      const from = new Date(Math.max(new Date(l.startDate).getTime(), start.getTime()));
      const to = new Date(Math.min(new Date(l.endDate).getTime(), end.getTime() - 1));
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) map.set(d.toISOString().slice(0, 10), l.type as string);
    }

    const regsByUser = new Map<string, Map<string, DayReg>>();
    for (const r of regs) {
      const uid = String(r.user);
      if (!regsByUser.has(uid)) regsByUser.set(uid, new Map());
      regsByUser.get(uid)!.set(new Date(r.date).toISOString().slice(0, 10), {
        _id: r._id, type: r.type as string, status: r.status as string,
        resultingStatus: (r as { resultingStatus?: string }).resultingStatus,
      });
    }
    const holidayMap = new Map<string, string>();
    for (const h of holidays) holidayMap.set(new Date(h.date).toISOString().slice(0, 10), h.name);

    const countable = new Set(["present", "late", "half_day", "absent", "on_leave", "holiday", "weekend", "wfh"]);
    const employeesOut = employees.map((e) => {
      const uid = (e.user as { _id?: unknown } | null)?._id ? String((e.user as { _id: unknown })._id) : "";
      // Static fallback for employees with no roster assignment covering a given day.
      const staticWorkDays: number[] = (e.user as { workSchedule?: { workDays?: number[] } } | null)?.workSchedule?.workDays ?? DEFAULT_WORK_DAYS;
      const rosterWindows = rosterMap.get(uid);
      const recs = attByUser.get(uid) ?? {};
      const leaveMap = leaveDaysByUser.get(uid) ?? new Map<string, string>();
      const regMap = regsByUser.get(uid) ?? new Map<string, DayReg>();
      // The schedule's own name for a leave type, so a custom one reads
      // properly instead of collapsing into a generic "On leave".
      const scheduleId = (e.user as { workSchedule?: { _id?: unknown } } | null)?.workSchedule?._id;
      const policies = policyIndex.for(scheduleId ? String(scheduleId) : null);
      const describeLeave = (type: string): DayLeave => {
        const p = policies.find((x) => x.type === type);
        return { type, label: p?.label ?? leaveLabel(type), paid: p ? p.paid : type !== "unpaid" };
      };

      const window = windows.get(String(e._id)) ?? { from: null, to: null };
      const days: Record<string, DayEntry> = {};
      const summary: Record<string, number> = { present: 0, late: 0, half_day: 0, absent: 0, on_leave: 0, holiday: 0, weekend: 0, wfh: 0, avgWorkedMinutes: 0 };
      let workedTotal = 0, workedDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${month}-${String(d).padStart(2, "0")}`;
        const dayDate = new Date(Date.UTC(year, monthIndex, d));
        const dow = dayDate.getUTCDay();
        const workDays = workDaysForDate(rosterWindows, dayDate) ?? staticWorkDays;
        let entry: DayEntry | null;
        if (recs[key]) {
          // A real record always shows, even out of window — the data exists
          // and hiding it would make the month impossible to reconcile.
          entry = recs[key];
          if ((entry.workedMinutes ?? 0) > 0) { workedTotal += entry.workedMinutes!; workedDays++; }
        } else if (!employedOn(window, key)) entry = null;
        else if (leaveMap.has(key)) entry = { status: leaveMap.get(key) === "wfh" ? "wfh" : "on_leave" };
        else if (holidayMap.has(key)) entry = { status: "holiday", note: holidayMap.get(key) };
        else if (!workDays.includes(dow)) entry = { status: "weekend" };
        else if (key < todayKey) entry = { status: "absent" };
        else entry = null;
        if (!entry) continue;
        // Attached whatever the day's status says, so leave stays visible even
        // when attendance was also recorded — previously a record hid it.
        if (leaveMap.has(key)) entry.leave = describeLeave(leaveMap.get(key)!);
        if (regMap.has(key)) entry.regularization = regMap.get(key);
        days[key] = entry;
        if (countable.has(entry.status)) summary[entry.status]++;
      }
      summary.avgWorkedMinutes = workedDays ? Math.round(workedTotal / workedDays) : 0;

      return {
        employee: { _id: e._id, name: e.name, employeeCode: e.employeeCode, designation: e.designation },
        days,
        summary,
        // Reported so a caller looking at one day can tell a day nobody marked
        // from a day this person was not on the payroll for. Both are blank.
        employment: window,
      };
    });

    return { month, year, daysInMonth, employees: employeesOut };
  }

  /**
   * Everybody's status on a single day.
   *
   * A slice of the month calendar rather than its own set of rules: the two
   * would otherwise drift, and one screen calling a day absent while another
   * calls it blank is exactly the confusion this is meant to settle.
   */
  async daily(date: string, employeeId?: string) {
    const { employees } = await this.calendar(date.slice(0, 7), employeeId);
    const orgTz = await this.orgTimeZone();
    const todayKey = todayInTz(orgTz);

    const rows = employees.map((e) => {
      const day = e.days[date];
      // A blank day means one of two different things, and saying which is the
      // whole point of this view.
      const status = day?.status ?? (employedOn(e.employment, date) ? "not_marked" : "not_employed");
      return { ...(day ?? {}), employee: e.employee, status };
    });

    // Only over people the day actually applies to — counting somebody who had
    // not joined yet as "not marked" would put a permanent gap in the figures.
    const counts: Record<string, number> = {};
    for (const r of rows) if (r.status !== "not_employed") counts[r.status] = (counts[r.status] ?? 0) + 1;

    return {
      date,
      isToday: date === todayKey,
      isFuture: date > todayKey,
      timeZone: orgTz,
      counts,
      total: rows.filter((r) => r.status !== "not_employed").length,
      employees: rows,
    };
  }
}
