import { Employee } from "../models/Employee.js";
import { orgFilter } from "../utils/orgContext.js";

/**
 * The login account of somebody's reporting manager.
 *
 * Two indirections make this less trivial than it reads. A regularization
 * belongs to a *user*, while the reporting line is recorded on the *employee*;
 * and `reportingTo` may point at either an Employee or a User, which is what
 * `reportingToKind` is for. Both ends are resolved back to a user id, because
 * that is what approving and emailing need.
 *
 * Returns null rather than guessing when the chain cannot be followed — an
 * employee with no manager, a manager with no login, or a user with no employee
 * record at all. The caller decides what to do about that; inventing an
 * approver would be worse than admitting there isn't one.
 */
export async function reportingManagerUserId(userId: unknown): Promise<string | null> {
  const employee = await Employee.findOne({ ...orgFilter(), user: userId })
    .select("reportingTo reportingToKind").lean();
  if (!employee?.reportingTo) return null;

  if (employee.reportingToKind === "User") return String(employee.reportingTo);

  const manager = await Employee.findOne({ ...orgFilter(), _id: employee.reportingTo })
    .select("user").lean();
  return manager?.user ? String(manager.user) : null;
}

/** Name and email of a manager, for the escalation notice. */
export async function managerContact(userId: string) {
  const { User } = await import("../models/User.js");
  return User.findOne({ ...orgFilter(), _id: userId })
    .select("name email").lean<{ _id: unknown; name?: string; email?: string } | null>();
}
