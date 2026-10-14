import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { hasLeft } from "../utils/employeeStatus.js";

/**
 * Once someone has left, their login goes inactive with them.
 *
 * Every way an employee is marked resigned or terminated — relieving a
 * resignation, the relieve job, ticking "left" on exit details, HR setting the
 * status on the record — changed the employee alone, so the login stayed
 * Active: the Users page showed leavers as current staff, and a leaver who
 * still knew their password could sign in. This closes it in one place.
 *
 * Signs them out too (the session version moves on). Never reactivates:
 * bringing a leaver back is a decision HR makes on the Users page, not a side
 * effect of a status changing back.
 */
export async function closeLoginIfLeft(employeeId: unknown): Promise<boolean> {
  const emp = await Employee.findById(employeeId).select("status user").lean<{ status?: string; user?: unknown } | null>();
  if (!emp?.user || !hasLeft(emp.status)) return false;
  const res = await User.updateOne(
    { _id: emp.user, status: { $ne: "inactive" } },
    { $set: { status: "inactive" }, $inc: { tokenVersion: 1 } }
  );
  return res.modifiedCount > 0;
}
