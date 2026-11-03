import { DEFAULT_WORK_DAYS, DEFAULT_SCHEDULE, localDayKey, zonedTimeToUtc } from "../utils/schedule.js";
import { CompOffCredit } from "../models/CompOffCredit.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { Holiday } from "../models/Holiday.js";
import { User } from "../models/User.js";
import { resolveWorkScheduleForUser } from "./workScheduleService.js";
import { assertNotSelfReview } from "./approvalWorkflowService.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import type { GrantCompOffInput, RequestCompOffInput, ApproveCompOffInput } from "../validations/compOffValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import type { ICompOffCredit } from "../types/index.js";

const round = (n: number) => Math.round(n * 100) / 100;

const CREDIT_POP = [
  { path: "employee", select: "name employeeCode designation" },
  { path: "createdBy", select: "name" },
  { path: "reviewedBy", select: "name" },
];

/** The day worked — see the ledger's fmtDate: local midnight, read back as its own day wherever the server runs. */
const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Math.round(new Date(d).getTime() / 86_400_000) * 86_400_000));
const daysLabel = (n: number) => `${n} comp-off day${n === 1 ? "" : "s"}`;

/**
 * Tell the person their day back is theirs — in the app and by mail.
 *
 * The mail is fired, not awaited: approving a long list in one go should not
 * wait on a mail server once per person, and a mail that fails takes nothing
 * back from a credit already approved.
 */
async function tellApproved(credit: Pick<ICompOffCredit, "user" | "date" | "amount" | "organization">, actor: string) {
  if (!credit.user) return;
  const day = fmtDay(credit.date);
  const has = credit.amount === 1 ? "has" : "have";
  await notify({
    users: [String(credit.user)],
    kind: "leave",
    tone: "positive",
    title: `${daysLabel(credit.amount)} approved`,
    body: `For working ${day} — added to your comp-off balance.`,
    href: "/leave",
    actor,
  });
  const user = await User.findById(credit.user).select("email").lean<{ email?: string } | null>();
  if (!user?.email) return;
  sendMail({
    to: user.email,
    organization: credit.organization,
    subject: `You've been credited ${daysLabel(credit.amount)}`,
    text: `You worked on ${day}, so ${daysLabel(credit.amount)} ${has} been added to your balance.\n\nView it: ${env.CLIENT_URL}/leave`,
    html:
      `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto">` +
      `<h2 style="color:#4f46e5;margin-bottom:4px">A day back</h2>` +
      `<p style="color:#555">You worked on <strong>${day}</strong>, so <strong>${daysLabel(credit.amount)}</strong> ${has} been added to your balance.</p>` +
      `<p><a href="${env.CLIENT_URL}/leave" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View my balance</a></p>` +
      `</div>`,
  }).catch(() => false);
}

/**
 * Available comp-off balance for a user: sum of available credits minus days
 * used by approved type="comp_off" leave requests. Computed on the fly (like
 * the other leave-balance math) so approving/cancelling a redemption request
 * automatically moves the balance — nothing to keep in sync separately.
 */
export async function compOffBalanceFor(userId: string): Promise<number> {
  // Org-scoped: the userId comes straight from a route param, so without this
  // a caller could read any other tenant's user's balance.
  const [credits, redemptions] = await Promise.all([
    CompOffCredit.find(scoped({ user: userId, status: "available" })).select("amount").lean(),
    LeaveRequest.find(scoped({ user: userId, type: "comp_off", status: "approved" })).select("days").lean(),
  ]);
  const earned = credits.reduce((a, c) => a + (c.amount || 0), 0);
  const redeemed = redemptions.reduce((a, r) => a + (r.days || 0), 0);
  return round(earned - redeemed);
}

interface Suggestion {
  employee: { _id: unknown; name: string; employeeCode?: string };
  user: string;
  date: Date;
  reason: "holiday" | "weekend";
  workedMinutes: number;
}

export class CompOffService {
  async grant(input: GrantCompOffInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    // HR adding it is HR deciding it — approved as it is made.
    const doc = await CompOffCredit.create({
      organization: getOrgId(),
      employee: employee._id,
      user: employee.user ?? null,
      date: input.date,
      amount: input.amount,
      reason: input.reason,
      status: "available",
      source: "hr",
      createdBy,
      reviewedBy: createdBy,
      reviewedAt: new Date(),
    });
    return CompOffCredit.findById(doc._id).populate(CREDIT_POP);
  }

  /**
   * An employee asking for a day back — for a weekend or holiday they worked
   * that attendance did not pick up. Pending until HR decides; it counts
   * toward nothing before then.
   */
  async request(userId: string, input: RequestCompOffInput) {
    const employee = await Employee.findOne(scoped({ user: userId })).select("_id name").lean<{ _id: unknown; name?: string } | null>();
    if (!employee) throw Object.assign(new Error("No employee record for your account"), { statusCode: 404 });

    // The day as the person reads it where they work, so it lines up with the
    // day attendance would have raised, and with "today" for them.
    const ws = await resolveWorkScheduleForUser(userId, input.date);
    const tz = (ws as { timeZone?: string } | null)?.timeZone || DEFAULT_SCHEDULE.timeZone;
    const key = input.date.toISOString().slice(0, 10);
    if (key > localDayKey(new Date(), tz)) {
      throw Object.assign(new Error("That day has not happened yet"), { statusCode: 400 });
    }

    const around = (n: number) => new Date(input.date.getTime() + n * 86_400_000);
    const sameWeek = await CompOffCredit.find(scoped({
      user: userId, status: { $in: ["pending", "available"] }, date: { $gte: around(-2), $lt: around(3) },
    })).select("date status").lean();
    const clash = sameWeek.find((c) => localDayKey(c.date, tz) === key);
    if (clash) {
      throw Object.assign(
        new Error(clash.status === "pending" ? "There is already a request for that day" : "That day has already been credited"),
        { statusCode: 409 }
      );
    }

    const doc = await CompOffCredit.create({
      organization: getOrgId(),
      employee: employee._id,
      user: userId,
      date: zonedTimeToUtc(key, "00:00", tz),
      amount: input.amount,
      reason: input.reason,
      status: "pending",
      source: "employee",
      createdBy: userId,
    });

    await notify({
      users: await watchersFor("leave", userId),
      kind: "leave",
      title: `${employee.name ?? "Someone"} asked for ${daysLabel(input.amount)}`,
      body: `For working ${fmtDay(doc.date)} · ${input.reason}`,
      href: "/leave",
      actor: userId,
    });
    return CompOffCredit.findById(doc._id).populate(CREDIT_POP);
  }

  /** HR saying yes — optionally to a different amount than was asked for. */
  async approve(id: string, input: ApproveCompOffInput, reviewerId: string) {
    const record = await CompOffCredit.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Comp-off request not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("Only a pending request can be approved"), { statusCode: 400 });
    }
    assertNotSelfReview(record.user, reviewerId);

    record.status = "available";
    if (input.amount !== undefined) record.amount = input.amount;
    record.reviewedBy = reviewerId as unknown as ICompOffCredit["reviewedBy"];
    record.reviewedAt = new Date();
    record.reviewNote = input.note ?? "";
    await record.save();

    await tellApproved(record, reviewerId);
    return CompOffCredit.findById(id).populate(CREDIT_POP);
  }

  /**
   * Several at once, each as asked. One that is not pending any more, or is
   * the reviewer's own, is skipped and counted rather than failing the rest.
   */
  async approveMany(ids: string[], reviewerId: string) {
    const records = await CompOffCredit.find(scoped({ _id: { $in: ids }, status: "pending" }));
    let approved = 0;
    let skipped = ids.length - records.length;
    for (const record of records) {
      if (String(record.user) === String(reviewerId)) { skipped++; continue; }
      const done = await CompOffCredit.updateOne(
        { _id: record._id, status: "pending" },
        { $set: { status: "available", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: "" } }
      );
      if (!done.modifiedCount) { skipped++; continue; }
      approved++;
      await tellApproved(record, reviewerId);
    }
    return { approved, skipped };
  }

  /** HR saying no — with a reason, which the person is shown. */
  async reject(id: string, note: string, reviewerId: string) {
    const record = await CompOffCredit.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Comp-off request not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("Only a pending request can be rejected"), { statusCode: 400 });
    }
    assertNotSelfReview(record.user, reviewerId);

    record.status = "rejected";
    record.reviewedBy = reviewerId as unknown as ICompOffCredit["reviewedBy"];
    record.reviewedAt = new Date();
    record.reviewNote = note;
    await record.save();

    await notify({
      users: [String(record.user)],
      kind: "leave",
      tone: "negative",
      title: "Comp-off request not approved",
      body: `For ${fmtDay(record.date)} — ${note}`,
      href: "/leave",
      actor: reviewerId,
    });
    return CompOffCredit.findById(id).populate(CREDIT_POP);
  }

  async list(query: { employee?: string; status?: string }) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;
    if (query.status) filter.status = query.status;
    return CompOffCredit.find(filter).populate(CREDIT_POP).sort({ date: -1 });
  }

  async revoke(id: string) {
    const record = await CompOffCredit.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Comp-off credit not found"), { statusCode: 404 });
    if (record.status !== "available") {
      throw Object.assign(new Error("Only available credits can be revoked"), { statusCode: 400 });
    }
    record.status = "revoked";
    await record.save();
    return CompOffCredit.findById(id).populate(CREDIT_POP);
  }

  async balanceFor(userId: string) {
    return { balance: await compOffBalanceFor(userId) };
  }

  /**
   * A person's own comp-off credits — earned dates, reasons, and status.
   *
   * `/comp-off/credits` (the full ledger) needs leave.approve, since it lists
   * everyone's; this is the self-service slice of the same collection, by
   * `user` rather than `employee` so it works the moment an Employee record
   * exists even without every field populated.
   */
  async myCredits(userId: string) {
    return CompOffCredit.find(scoped({ user: userId })).populate({ path: "reviewedBy", select: "name" }).sort({ date: -1 });
  }

  /**
   * Attendance in the last `days` where the employee actually worked
   * (present/late/half_day with worked minutes) on a day that was a weekend
   * or declared holiday for their schedule — and has no credit yet. A request
   * of any status counts as one, so a rejected day is not raised again.
   */
  async suggestions(days = 60): Promise<Suggestion[]> {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    const [att, employees, existingCredits, holidays, exclusiveScheduleIdList] = await Promise.all([
      Attendance.find({
        ...orgFilter(), date: { $gte: start, $lt: end },
        status: { $in: ["present", "late", "half_day"] }, workedMinutes: { $gt: 0 },
      }).select("user date status workedMinutes").lean(),
      Employee.find({ ...orgFilter(), user: { $ne: null } }).select("name employeeCode user workMode").lean(),
      CompOffCredit.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("user date").lean(),
      // Every calendar in play, kept apart below: this walks the whole
      // organisation, and one person's holiday is another's working day.
      Holiday.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("date workMode workSchedule").lean(),
      // Every schedule with a calendar of its own, org-wide and not scoped to
      // this window — see holidayScope. Replaces the work-mode fallback for
      // anyone on it rather than adding to it.
      Holiday.distinct("workSchedule", { ...orgFilter(), workSchedule: { $ne: null } }),
    ]);
    const exclusiveScheduleIds = new Set(exclusiveScheduleIdList.map(String));

    const empByUser = new Map(employees.map((e) => [String(e.user), e]));
    /*
     * The day a record belongs to, read in the timezone it was written for.
     *
     * Attendance stores a day as its local midnight expressed in UTC: a Dubai
     * day of the 8th is 20:00Z on the 7th, an Indian one 18:30Z. Reading that
     * back with `toISOString()` lands a day earlier — which quietly turned
     * every Monday into a Sunday and paid comp-off for an ordinary working
     * day, while the genuine Sunday behind it read as Saturday and earned
     * nothing at all.
     */
    const dateKeyOf = (d: Date, tz: string) => localDayKey(d, tz);
    /** Day of week of a calendar key, with no timezone left in it to shift. */
    const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
    const creditKey = (u: string, d: string) => `${u}|${d}`;
    /**
     * A day off, for whoever is being asked about.
     *
     * One set per calendar rather than one for the organisation: a Kerala
     * holiday is an ordinary working day in Dubai, and crediting comp-off
     * against it would hand seventy-four people a day back they never lost.
     *
     * Read in the same timezone as the day being asked about, since a holiday
     * is stored at its own local midnight too.
     */
    // A holiday tagged to one schedule is that schedule's alone, work mode
    // notwithstanding — see holidayScope for the same rule elsewhere.
    const holidayFor = (mode: string | null | undefined, key: string, tz: string, scheduleId?: unknown) =>
      holidays.some((h) => {
        if (dateKeyOf(h.date, tz) !== key) return false;
        if ((h as { workSchedule?: unknown }).workSchedule) {
          return scheduleId != null && String((h as { workSchedule?: unknown }).workSchedule) === String(scheduleId);
        }
        // A schedule with its own tagged calendar replaces the work-mode
        // fallback for anyone on it, rather than adding to it.
        if (scheduleId != null && exclusiveScheduleIds.has(String(scheduleId))) return false;
        return !h.workMode || h.workMode === mode;
      });

    // One schedule lookup per person rather than per attendance row: sixty days
    // of attendance for one employee asked the same question sixty times.
    const scheduleCache = new Map<string, { tz: string; workDays: number[]; scheduleId: unknown }>();
    const scheduleFor = async (uid: string, on: Date) => {
      const cached = scheduleCache.get(uid);
      if (cached) return cached;
      const ws = await resolveWorkScheduleForUser(uid, on);
      const resolved = {
        tz: (ws as { timeZone?: string } | null)?.timeZone || DEFAULT_SCHEDULE.timeZone,
        workDays: ws?.workDays?.length ? ws.workDays : DEFAULT_WORK_DAYS,
        scheduleId: (ws as { _id?: unknown } | null)?._id ?? null,
      };
      scheduleCache.set(uid, resolved);
      return resolved;
    };

    // Credits keyed the same way as the rows they would block, in that
    // person's timezone — a credit records the attendance day it was earned on.
    const creditsByUser = new Map<string, typeof existingCredits>();
    for (const c of existingCredits) {
      const k = String(c.user);
      const list = creditsByUser.get(k) ?? [];
      list.push(c);
      creditsByUser.set(k, list);
    }
    const creditSet = new Set<string>();
    for (const [uid, list] of creditsByUser) {
      const { tz } = await scheduleFor(uid, new Date(list[0]!.date));
      for (const c of list) creditSet.add(creditKey(uid, dateKeyOf(c.date, tz)));
    }

    const results: Suggestion[] = [];
    for (const a of att) {
      const uid = String(a.user);
      const emp = empByUser.get(uid);
      if (!emp) continue;

      const { tz, workDays, scheduleId } = await scheduleFor(uid, new Date(a.date));
      const dateKey = dateKeyOf(a.date, tz);
      if (creditSet.has(creditKey(uid, dateKey))) continue;

      const isHoliday = holidayFor((emp as { workMode?: string }).workMode, dateKey, tz, scheduleId);
      const isWeekend = isHoliday ? false : !workDays.includes(weekdayOf(dateKey));
      if (!isHoliday && !isWeekend) continue;

      results.push({
        employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode },
        user: uid,
        date: a.date,
        reason: isHoliday ? "holiday" : "weekend",
        workedMinutes: a.workedMinutes ?? 0,
      });
    }
    return results;
  }
}
