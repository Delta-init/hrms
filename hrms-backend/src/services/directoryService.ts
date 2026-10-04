import { Organization } from "../models/Organization.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { stillHere } from "../utils/employeeStatus.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { scheduleOf, leavesIn, type WorkHoursRow } from "../utils/workHours.js";

/**
 * The read-only view of who exists in HRMS, for Delta Finance to map against.
 *
 * Deliberately cross-organization and therefore deliberately *not* built on
 * `scoped()`. Every other service in this codebase narrows to the caller's org
 * via the request-scoped context; this one has no user and no org — the finance
 * server is asking "what organizations are there at all?" so that an
 * administrator can link them. Every query below therefore filters on an
 * explicit `organization` argument, and the org id is always supplied by the
 * caller rather than inferred. Adding a `scoped()` here would silently return
 * nothing; forgetting the explicit filter would leak another tenant's roster.
 *
 * What is NOT exposed here, on purpose: salary and bank details. Mapping needs
 * to know that somebody exists, not what they are paid. Payroll figures cross
 * later, on the payroll-run endpoints, where they belong to a specific month
 * that finance has been handed. `hasBankDetails` is included as a bare boolean
 * because "mapped but unpayable" is exactly the warning the reconcile screen
 * needs before a payroll run, and it discloses nothing.
 */

export interface DirectoryOrganization {
  id: string;
  name: string;
  code: string;
  currency: string;
  timeZone: string;
  status: string;
}

export interface DirectoryDepartment {
  id: string;
  organizationId: string | null;
  name: string;
  code: string;
  status: string;
}

export interface DirectoryEmployee {
  id: string;
  organizationId: string | null;
  employeeCode: string;
  name: string;
  email: string;
  departmentId: string | null;
  designation: string;
  employmentType: string;
  status: string;
  joiningDate: string | null;
  currency: string;
  hasBankDetails: boolean;
  updatedAt: string;
}

export class DirectoryService {
  /** Every organization finance could link a payroll pipeline to. */
  async organizations(): Promise<DirectoryOrganization[]> {
    const orgs = await Organization.find({}).sort({ name: 1 }).lean();
    return orgs.map((o) => ({
      id: String(o._id),
      name: o.name,
      code: o.code,
      currency: o.settings?.currency ?? "AED",
      timeZone: o.settings?.timeZone ?? "Asia/Dubai",
      status: o.status ?? "active",
    }));
  }

  /** Departments belonging to one HRMS organization. */
  async departments(organizationId: string): Promise<DirectoryDepartment[]> {
    const rows = await Department.find({ organization: organizationId }).sort({ name: 1 }).lean();
    return rows.map((d) => ({
      id: String(d._id),
      organizationId: d.organization ? String(d.organization) : null,
      name: d.name,
      code: d.code ?? "",
      status: d.status ?? "active",
    }));
  }

  /**
   * The roster of one HRMS organization.
   *
   * `updatedSince` exists so a re-sync costs one small page rather than the
   * whole company, but the first sync of an org genuinely is everybody — hence
   * the page/limit rather than an unbounded array.
   */
  async employees(
    organizationId: string,
    opts: { updatedSince?: string; page?: number; limit?: number; includeInactive?: boolean } = {}
  ): Promise<{ rows: DirectoryEmployee[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 200));

    const filter: Record<string, unknown> = { organization: organizationId };

    // Leavers are included by default and flagged rather than hidden. A person
    // who left still has a final payslip and still needs their finance-side
    // record deactivated — dropping them from the feed would strand it.
    if (!opts.includeInactive) filter.status = stillHere();

    if (opts.updatedSince) {
      const since = new Date(opts.updatedSince);
      if (!Number.isNaN(since.getTime())) filter.updatedAt = { $gte: since };
    }

    const [rows, total] = await Promise.all([
      Employee.find(filter)
        .select("organization employeeCode name email department designation employmentType status joiningDate currency bank updatedAt")
        .sort({ employeeCode: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Employee.countDocuments(filter),
    ]);

    return {
      rows: rows.map((e) => {
        const bank = (e as { bank?: { ibanIfsc?: string; bankAccountNumber?: string } }).bank;
        return {
          id: String(e._id),
          organizationId: e.organization ? String(e.organization) : null,
          employeeCode: e.employeeCode,
          name: e.name,
          email: e.email ?? "",
          departmentId: e.department ? String(e.department) : null,
          designation: e.designation ?? "",
          employmentType: e.employmentType ?? "full_time",
          status: e.status ?? "active",
          joiningDate: e.joiningDate ? new Date(e.joiningDate).toISOString() : null,
          currency: e.currency ?? "AED",
          hasBankDetails: Boolean(bank?.ibanIfsc || bank?.bankAccountNumber),
          updatedAt: e.updatedAt ? new Date(e.updatedAt as Date).toISOString() : "",
        };
      }),
      total,
      page,
      limit,
    };
  }

  /**
   * Working hours for the people with these emails: their schedule's shift and days (the default, said so, when
   * none is assigned) and their approved leave touching [from, to] (YYYY-MM-DD). For the commission portal's
   * Mentor Calendar, which knows its mentors by email only — so within `organizationId` when given, else by email
   * wherever they are. Leavers are left out: nobody books time with them.
   */
  async workHours(opts: { emails: string[]; from: string; to: string; organizationId?: string }): Promise<WorkHoursRow[]> {
    const filter: Record<string, unknown> = { email: { $in: opts.emails }, status: stillHere() };
    if (opts.organizationId) filter.organization = opts.organizationId;
    const employees = await Employee.find(filter).select("email name workSchedule user").lean();
    if (!employees.length) return [];

    const scheduleIds = [...new Set(employees.map((e) => (e.workSchedule ? String(e.workSchedule) : "")).filter(Boolean))];
    const schedules = new Map(
      (await WorkSchedule.find({ _id: { $in: scheduleIds } }).lean()).map((w) => [String(w._id), w]),
    );
    // A day either side: leave is stored as instants, and the days it covers are read in its own time zone below.
    const userIds = employees.map((e) => e.user).filter(Boolean);
    const leaves = userIds.length
      ? await LeaveRequest.find({
        user: { $in: userIds },
        status: "approved",
        startDate: { $lte: new Date(new Date(`${opts.to}T00:00:00Z`).getTime() + 2 * 86_400_000) },
        endDate: { $gte: new Date(new Date(`${opts.from}T00:00:00Z`).getTime() - 2 * 86_400_000) },
      }).select("user type startDate endDate halfDay timeZone").lean()
      : [];
    const leavesOf = new Map<string, typeof leaves>();
    for (const l of leaves) leavesOf.set(String(l.user), [...(leavesOf.get(String(l.user)) ?? []), l]);

    return employees.map((e) => ({
      email: e.email ?? "",
      name: e.name,
      schedule: scheduleOf(e.workSchedule ? schedules.get(String(e.workSchedule)) : null),
      leaves: e.user ? leavesIn(leavesOf.get(String(e.user)) ?? [], opts.from, opts.to) : [],
    }));
  }
}

export const directoryService = new DirectoryService();
