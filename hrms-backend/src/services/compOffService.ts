import { CompOffCredit } from "../models/CompOffCredit.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { Holiday } from "../models/Holiday.js";
import { resolveWorkScheduleForUser } from "./workScheduleService.js";
import type { GrantCompOffInput } from "../validations/compOffValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const round = (n: number) => Math.round(n * 100) / 100;

const CREDIT_POP = [
  { path: "employee", select: "name employeeCode designation" },
  { path: "createdBy", select: "name" },
];

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

    const doc = await CompOffCredit.create({
      organization: getOrgId(),
      employee: employee._id,
      user: employee.user ?? null,
      date: input.date,
      amount: input.amount,
      reason: input.reason,
      createdBy,
    });
    return CompOffCredit.findById(doc._id).populate(CREDIT_POP);
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
   * Attendance in the last `days` where the employee actually worked
   * (present/late/half_day with worked minutes) on a day that was a weekend
   * or declared holiday for their schedule — and has no credit yet.
   */
  async suggestions(days = 60): Promise<Suggestion[]> {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    const [att, employees, existingCredits, holidays] = await Promise.all([
      Attendance.find({
        ...orgFilter(), date: { $gte: start, $lt: end },
        status: { $in: ["present", "late", "half_day"] }, workedMinutes: { $gt: 0 },
      }).select("user date status workedMinutes").lean(),
      Employee.find({ ...orgFilter(), user: { $ne: null } }).select("name employeeCode user").lean(),
      CompOffCredit.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("user date").lean(),
      Holiday.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("date").lean(),
    ]);

    const empByUser = new Map(employees.map((e) => [String(e.user), e]));
    const dateKeyOf = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const creditKey = (u: string, d: string) => `${u}|${d}`;
    const creditSet = new Set(existingCredits.map((c) => creditKey(String(c.user), dateKeyOf(c.date))));
    const holidaySet = new Set(holidays.map((h) => dateKeyOf(h.date)));

    const results: Suggestion[] = [];
    for (const a of att) {
      const uid = String(a.user);
      const dateKey = dateKeyOf(a.date);
      if (creditSet.has(creditKey(uid, dateKey))) continue;
      const emp = empByUser.get(uid);
      if (!emp) continue;

      const isHoliday = holidaySet.has(dateKey);
      let isWeekend = false;
      if (!isHoliday) {
        const ws = await resolveWorkScheduleForUser(uid, new Date(a.date));
        const workDays = ws?.workDays ?? [1, 2, 3, 4, 5];
        isWeekend = !workDays.includes(new Date(a.date).getUTCDay());
      }
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
