import { Reminder } from "../models/Reminder.js";
import { Employee } from "../models/Employee.js";
import type { CreateReminderInput } from "../validations/reminderValidation.js";
import type { IReminder, ReminderStage } from "../types/index.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { zonedTimeToUtc } from "../utils/schedule.js";
import { stillHere } from "../utils/employeeStatus.js";

const POP = [
  { path: "createdBy", select: "name email" },
  { path: "department", select: "name" },
];

/**
 * The instant a reminder's stages are measured against, and the moments each
 * stage fires at.
 *
 * A date-only reminder has no instant to count down to — it only ever fires
 * "dayBefore", at 18:00 the day before, the same convention the holiday
 * reminder already uses. A timed reminder's three stages count back from the
 * moment itself.
 */
export function stageThresholds(reminder: Pick<IReminder, "date" | "time" | "timeZone">): Partial<Record<ReminderStage, Date>> {
  const dateStr = new Date(reminder.date).toISOString().slice(0, 10);
  const tz = reminder.timeZone || "Asia/Dubai";

  if (!reminder.time) {
    const dayBeforeStr = new Date(new Date(reminder.date).getTime() - 86_400_000).toISOString().slice(0, 10);
    return { dayBefore: zonedTimeToUtc(dayBeforeStr, "18:00", tz) };
  }

  const at = zonedTimeToUtc(dateStr, reminder.time, tz);
  return {
    "30min": new Date(at.getTime() - 30 * 60_000),
    "5min": new Date(at.getTime() - 5 * 60_000),
    ontime: at,
  };
}

/** Every user id a reminder should reach, resolved at send time. */
export async function recipientsFor(reminder: IReminder): Promise<string[]> {
  if (reminder.audience === "self") return [String(reminder.createdBy)];

  const filter: Record<string, unknown> = scoped({ status: stillHere(), user: { $ne: null } });
  if (reminder.audience === "team") {
    if (!reminder.department) return [];
    filter.department = reminder.department;
  }
  const employees = await Employee.find(filter).select("user").lean<Array<{ user: unknown }>>();
  return employees.map((e) => String(e.user));
}

export class ReminderService {
  async create(input: CreateReminderInput, createdBy: string) {
    let department: unknown = null;
    if (input.audience === "team") {
      const employee = await Employee.findOne(scoped({ user: createdBy })).select("department");
      if (!employee?.department) {
        throw Object.assign(new Error("You need to be in a department to send a team reminder"), { statusCode: 400 });
      }
      department = employee.department;
    }

    const doc = await Reminder.create({
      organization: getOrgId(),
      createdBy,
      title: input.title,
      message: input.message,
      audience: input.audience,
      department,
      date: new Date(`${input.date}T00:00:00.000Z`),
      time: input.time ?? null,
      timeZone: input.timeZone,
    });
    return Reminder.findById(doc._id).populate(POP);
  }

  /** Reminders this person created, most recent first. */
  async mine(userId: string) {
    return Reminder.find(scoped({ createdBy: userId })).populate(POP).sort({ date: -1, createdAt: -1 });
  }

  /** Withdraw a reminder before it fires — only its own creator may. */
  async cancel(id: string, userId: string) {
    const record = await Reminder.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Reminder not found"), { statusCode: 404 });
    if (String(record.createdBy) !== userId) {
      throw Object.assign(new Error("Only the person who created this reminder can cancel it"), { statusCode: 403 });
    }
    if (record.status !== "scheduled") {
      throw Object.assign(new Error("This reminder has already gone out or was already cancelled"), { statusCode: 400 });
    }
    record.status = "cancelled";
    await record.save();
    return record;
  }
}
