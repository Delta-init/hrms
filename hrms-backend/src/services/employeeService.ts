import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { assertRoleAssignable } from "./roleService.js";
import { Resignation } from "../models/Resignation.js";
import { Payslip } from "../models/Payslip.js";
import { FaceProfile } from "../models/FaceProfile.js";
import type { CreateEmployeeInput, UpdateEmployeeInput, UpdateMyProfileInput, CreateLoginInput } from "../validations/employeeValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { publicUrl } from "../config/r2.js";
import { randomBytes } from "node:crypto";

interface EmployeeQuery extends PaginationQuery {
  excludeTerminated?: string;
  department?: string;
  employmentType?: string;
  /** "office" | "wfh" — where the person works. */
  workMode?: string;
  /** A work schedule's id, or "none" for the people who have not been given one. */
  workSchedule?: string;
  /** "yes" | "no" — whether the person has set up face check-in. */
  faceEnrolled?: string;
  /** "current" | "leavers" | "all" — whether to include people who have left. */
  staff?: string;
  /** How somebody left: resignation, termination, retirement, … */
  exitType?: string;
}

const POP = [
  { path: "department", select: "name code" },
  { path: "workSchedule", select: "name timeZone loginTime logoutTime" },
  { path: "user", select: "name email" },
  { path: "reportingTo", select: "name employeeCode designation email" },
];

/**
 * Keep the login's copy of the work schedule in step with the employee's.
 *
 * Two documents hold this: the employee record, which is where HR edits it,
 * and the login, which is the only one attendance reads
 * (resolveWorkScheduleForUser). createLogin copies it once at creation and
 * nothing carried a later change across, so every edit after that day moved
 * the employee record alone and left attendance scoring the person against
 * whatever their shift had been when their account was made — or, for anyone
 * whose login never got one, against a hardcoded 09:00-18:00 Asia/Dubai.
 * People who arrived on time were recorded late for it.
 */
async function mirrorScheduleToLogin(record: { user?: unknown; workSchedule?: unknown }, changed: boolean) {
  if (!changed || !record.user) return;
  await User.updateOne({ _id: record.user }, { $set: { workSchedule: record.workSchedule ?? null } });
}

/** Normalize optional ref/blank fields for persistence. */
function clean<T extends Record<string, unknown>>(input: T) {
  const out: Record<string, unknown> = { ...input };
  for (const k of ["department", "workSchedule", "user", "reportingTo"]) {
    if (out[k] !== undefined) out[k] = out[k] || null;
  }
  if (out.email === "") out.email = undefined;
  if (out.personalEmail === "") out.personalEmail = undefined;
  return out;
}

/**
 * A temporary password that satisfies the login policy.
 *
 * Generated rather than typed: the login can now be provisioned in the same
 * step as the employee, where there is no password box, and a random one beats
 * the handful of memorable strings that get reused otherwise. The employee is
 * forced to replace it on first sign-in either way.
 */
function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const bytes = randomBytes(16);
  const pick = (set: string, i: number) => set[bytes[i] % set.length];
  // One of each class up front guarantees the policy, then fill to length.
  const chars = [pick(upper, 0), pick(lower, 1), pick(digits, 2)];
  for (let i = 3; i < 12; i++) chars.push(pick(all, i));
  // Shuffle so the guaranteed characters aren't always in the same positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function inviteEmailHtml(name: string, email: string, temporaryPassword: string, activateUrl: string) {
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:#4f46e5">Welcome to Delta HRMS</h2>
    <p style="color:#555">Hi ${name}, an account has been created for you. Use these details to sign in for the first time:</p>
    <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#888">Email</td><td style="padding:4px 0;font-weight:600">${email}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Temporary password</td><td style="padding:4px 0;font-weight:600;font-family:monospace">${temporaryPassword}</td></tr>
    </table>
    <p><a href="${activateUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Activate your account</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">You'll be asked to set your own password on first sign-in. Sent automatically by Delta HRMS.</p>
  </div>`;
}

export class EmployeeService {
  async create(input: CreateEmployeeInput) {
    const existing = await Employee.findOne(scoped({ employeeCode: input.employeeCode.trim().toUpperCase() }));
    if (existing) throw Object.assign(new Error("Employee code already exists"), { statusCode: 409 });

    const { login, ...fields } = input;
    const emp = await Employee.create({ ...clean(fields), organization: getOrgId() });

    // Provisioning the login is a follow-on step, not part of the employee: a
    // duplicate email or an unassignable role must not throw away the record
    // that was just created. The caller is told what went wrong instead, and
    // can retry from the employee's page.
    let loginError: string | undefined;
    if (login) {
      try {
        await this.createLogin(String(emp._id), { role: login.role, email: login.email });
      } catch (error) {
        loginError = error instanceof Error ? error.message : "The login could not be created";
      }
    }

    const record = await Employee.findById(emp._id).populate(POP);
    return { record, loginError };
  }

  async list(query: EmployeeQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) {
      const rx = searchRegex(query.search);
      filter.$or = [{ name: rx }, { employeeCode: rx }, { email: rx }, { designation: rx }];
    }
    if (query.status) filter.status = query.status;
    // Pickers exclude leavers. Done here rather than by filtering the returned
    // page, which drops people from the middle of a paginated result.
    else if (query.excludeTerminated === "true") filter.status = { $ne: "terminated" };
    else if (query.staff === "current") filter.status = { $ne: "terminated" };
    else if (query.staff === "leavers") filter.status = "terminated";

    /**
     * How somebody left.
     *
     * The employee record only knows "terminated", which lumps a resignation
     * in with a dismissal — the distinction lives on the resignation record,
     * so this resolves there and comes back as a set of employee ids.
     *
     * Resolved into a constraint rather than by filtering the returned page,
     * the same reason `staff` above is: a page-level filter drops people out of
     * the middle of a paginated result and makes the total a lie.
     */
    if (query.exitType) {
      const left = await Resignation.find({ ...orgFilter(), resignationType: query.exitType })
        .select("employee").lean();
      filter._id = { $in: left.map((r) => r.employee) };
      // Asking how somebody left only makes sense about somebody who has.
      if (!query.status && query.staff !== "all") filter.status = "terminated";
    }
    if (query.department) filter.department = query.department;
    // "none" is the useful half of this filter: it is the only way to see who
    // is still falling through to the fallback shift, which is not something
    // any other screen shows.
    if (query.workSchedule === "none") filter.workSchedule = null;
    else if (query.workSchedule) filter.workSchedule = query.workSchedule;
    if (query.employmentType) filter.employmentType = query.employmentType;
    // Records written before the field existed have no `workMode` at all —
    // Mongoose only applies the default when a document is saved. Asking for
    // office staff has to mean "office or not yet set", or the migrated
    // hundred would answer to neither filter.
    if (query.workMode === "office") filter.workMode = { $in: ["office", null] };
    else if (query.workMode) filter.workMode = query.workMode;

    /**
     * Who has set up face check-in, and who has not.
     *
     * Resolved into a `user` constraint rather than filtering the returned page,
     * because a page-level filter drops people out of the middle of a paginated
     * result and makes the total a lie — the same reason `excludeTerminated`
     * above is done here.
     *
     * "Not enrolled" deliberately includes everybody without a login: a face is
     * matched to a punch through the login account, so somebody who has none
     * cannot enrol, and leaving them out would hide exactly the people an
     * administrator is looking for.
     */
    if (query.faceEnrolled === "yes" || query.faceEnrolled === "no") {
      const enrolled = await FaceProfile.find(orgFilter()).select("user").lean();
      const ids = enrolled.map((p) => p.user);
      filter.user = query.faceEnrolled === "yes" ? { $in: ids } : { $nin: ids };
    }

    const sortable = new Set(["name", "employeeCode", "designation", "status", "joiningDate", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [rows, total] = await Promise.all([
      Employee.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Employee.countDocuments(filter),
    ]);
    /**
     * How the leavers on this page left, and when.
     *
     * "Terminated" is the only status the employee record has, so on its own it
     * says somebody has gone but not whether they resigned or were dismissed —
     * a distinction that matters to anyone reading the list. Looked up only for
     * the leavers actually on this page, so a page of current staff costs
     * nothing.
     */
    const leaverIds = rows.filter((r) => r.status === "terminated").map((r) => r._id);
    const exits = leaverIds.length
      ? await Resignation.find({ ...orgFilter(), employee: { $in: leaverIds } })
          .select("employee resignationType lastWorkingDay").sort({ lastWorkingDay: -1 }).lean()
      : [];
    const exitByEmployee = new Map<string, { resignationType?: string; lastWorkingDay?: Date }>();
    for (const e of exits) if (!exitByEmployee.has(String(e.employee))) exitByEmployee.set(String(e.employee), e);

    // lean() skips the schema's toJSON transform, so the photo URL is added here.
    const records = rows.map((r) => {
      const exit = exitByEmployee.get(String(r._id));
      return {
        ...r,
        photoUrl: r.photo ? publicUrl(String(r.photo)) : "",
        ...(exit
          ? { exitType: exit.resignationType ?? null, lastWorkingDay: exit.lastWorkingDay ?? null }
          : {}),
      };
    });
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /**
   * The code to offer for the next employee — one past the highest existing
   * one, keeping its prefix and zero-padding (EMP-060 → EMP-061).
   *
   * Derived from the highest code rather than the employee count, which drifts
   * the moment anyone is deleted or a code is entered by hand. Codes with no
   * trailing number (a one-off like "AMAMA") can't be sequenced and are
   * ignored; when several prefixes are in use the most common one wins, so a
   * stray oddity doesn't hijack the series. The caller can still overwrite it.
   */
  async nextCode(): Promise<string> {
    const rows = await Employee.find(orgFilter()).select("employeeCode").lean();

    const parsed = rows
      .map((r) => /^(.*?)(\d+)$/.exec(String(r.employeeCode ?? "").trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ prefix: m[1], num: parseInt(m[2], 10), width: m[2].length }));

    if (!parsed.length) return "EMP-001";

    const byPrefix = new Map<string, number>();
    for (const p of parsed) byPrefix.set(p.prefix, (byPrefix.get(p.prefix) ?? 0) + 1);
    const prefix = [...byPrefix.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

    const highest = parsed.filter((p) => p.prefix === prefix).reduce((a, b) => (b.num > a.num ? b : a));
    const taken = new Set(rows.map((r) => String(r.employeeCode ?? "").trim()));

    // Skip anything already taken — a gap-filling code entered by hand could
    // otherwise collide and fail the create with a duplicate error.
    for (let n = highest.num + 1; n <= highest.num + 1000; n++) {
      const code = prefix + String(n).padStart(highest.width, "0");
      if (!taken.has(code)) return code;
    }
    return prefix + String(highest.num + 1).padStart(highest.width, "0");
  }

  /**
   * Refuse a reporting line that can't hold.
   *
   * `reportingTo` was previously accepted as any string: a manager could be
   * missing, belong to another tenant, have left, or close a loop. The org
   * chart tolerates loops by promoting people to roots, which hides bad data
   * rather than preventing it — and now that the chart lets you drag someone
   * onto anyone, a loop is one gesture away rather than a rare typo.
   */
  private async assertValidManager(employeeId: string, managerRef: string, kind: "Employee" | "User") {
    // A login account is resolved to the employee behind it; the chart is
    // employee-to-employee, so an unlinked account can't be a chart parent.
    const manager = kind === "User"
      ? await Employee.findOne(scoped({ user: managerRef })).select("_id status").lean()
      : await Employee.findOne(scoped({ _id: managerRef })).select("_id status").lean();

    if (!manager) {
      throw Object.assign(new Error("That manager could not be found in this organization"), { statusCode: 400 });
    }
    if (manager.status === "terminated") {
      throw Object.assign(new Error("Someone who has left cannot be assigned as a manager"), { statusCode: 400 });
    }
    if (String(manager._id) === String(employeeId)) {
      throw Object.assign(new Error("An employee cannot report to themselves"), { statusCode: 400 });
    }

    // Walk up from the proposed manager: reaching the employee means the new
    // line would close a loop.
    let cursor: string | null = String(manager._id);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node: { reportingTo?: unknown; reportingToKind?: string } | null =
        await Employee.findById(cursor).select("reportingTo reportingToKind").lean();
      if (!node?.reportingTo) break;
      const next: { _id: unknown } | null = node.reportingToKind === "User"
        ? await Employee.findOne(scoped({ user: node.reportingTo })).select("_id").lean()
        : await Employee.findById(String(node.reportingTo)).select("_id").lean();
      cursor = next ? String(next._id) : null;
      if (cursor === String(employeeId)) {
        throw Object.assign(
          new Error("That would create a reporting loop — the person already reports to this employee"),
          { statusCode: 400 }
        );
      }
    }
  }

  async getById(id: string) {
    const record = await Employee.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    return record;
  }

  /** Resolve the employee record linked to a login account. */
  async getByUser(userId: string) {
    const record = await Employee.findOne(scoped({ user: userId })).populate(POP);
    if (!record) throw Object.assign(new Error("No employee is linked to this user"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateEmployeeInput) {
    const record = await Employee.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    if (input.employeeCode && input.employeeCode.toUpperCase() !== record.employeeCode) {
      const dupe = await Employee.findOne(scoped({ employeeCode: input.employeeCode.trim().toUpperCase(), _id: { $ne: id } }));
      if (dupe) throw Object.assign(new Error("Employee code already exists"), { statusCode: 409 });
    }

    // Clearing the line (null/"") is always allowed; setting one must hold up.
    if (input.reportingTo) {
      await this.assertValidManager(id, input.reportingTo, input.reportingToKind ?? "Employee");
    }

    Object.assign(record, clean(input));
    // Some legacy records have location stored as "" from before its enum
    // validator existed; that now fails full-document validation on every
    // save, even one that never touches location. Self-heal it on next touch
    // instead of leaving the record permanently unsavable.
    if ((record.location as unknown as string) === "") record.location = undefined;
    await record.save();
    await mirrorScheduleToLogin(record, input.workSchedule !== undefined);
    return Employee.findById(id).populate(POP);
  }

  /** Self-service — the caller edits their own personal-information sections only. */
  async updateMyProfile(userId: string, input: UpdateMyProfileInput) {
    const employee = await Employee.findOne(scoped({ user: userId }));
    if (!employee) throw Object.assign(new Error("No employee is linked to your account"), { statusCode: 404 });
    return this.update(String(employee._id), input as UpdateEmployeeInput);
  }

  /**
   * Forget the browser a remote employee was tied to.
   *
   * The way out of every ordinary lockout — a new laptop, a reinstalled
   * browser, cleared site data, a lost phone. Deliberately a clean slate
   * rather than a re-registration: HR cannot know which browser the person is
   * about to sit in front of, so the next punch registers it, exactly as the
   * first one did.
   */
  async resetTrustedDevice(id: string) {
    const employee = await Employee.findOne(scoped({ _id: id }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    employee.set("trustedDevice", null);
    await employee.save();
    return { message: "Device reset. The next punch will register a new one." };
  }

  async remove(id: string) {
    const record = await Employee.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    // A payslip belongs to somebody. Deleting the employee out from under one
    // leaves a pay record pointing at nobody — it cannot be listed, because
    // every payslip screen is reached through an employee, and it cannot be
    // exported to accounts, because there is no one to pay. Finance blocks the
    // whole month's import when it finds one, and the only way out is a
    // database edit.
    //
    // Deleting the payslips alongside the employee would be worse: those are
    // the record of what somebody was paid, and they outlive the employment.
    // So the delete is refused and the payslips named.
    const payslipCount = await Payslip.countDocuments({ employee: record._id });
    if (payslipCount > 0) {
      throw Object.assign(
        new Error(
          `${record.name} has ${payslipCount} payslip(s) and cannot be deleted. ` +
            `Delete the payslips first if they are not needed, or mark the employee as terminated to keep the pay history.`,
        ),
        { statusCode: 409 },
      );
    }

    await Employee.deleteOne({ _id: record._id });
    // Otherwise left as a dangling reference — the Resignations list would show a blank row.
    await Resignation.deleteMany({ employee: record._id });
    return { message: "Employee deleted successfully" };
  }

  /**
   * Provision a login account for an employee. Creates an invited User with
   * mustResetPassword = true, so the employee sets their own password on first
   * login (via the /auth/set-password activation flow), then links it.
   */
  async createLogin(id: string, input: CreateLoginInput) {
    const employee = await Employee.findOne(scoped({ _id: id }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    // A reference here doesn't prove the account survives. Deleting a login used
    // to leave the employee pointing at nothing, and this check — reading the
    // raw id, where every other read populates it to null — then refused to
    // issue a replacement, locking the employee out for good. Confirm the
    // account is real before refusing, and release the link when it isn't.
    // Unscoped on purpose: an account in another tenant still exists, and
    // issuing a second login for it would be wrong.
    if (employee.user) {
      const linked = await User.findById(employee.user).select("status email").lean<{ status?: string; email?: string } | null>();
      if (linked && linked.status !== "inactive") {
        throw Object.assign(new Error("This employee already has a login account"), { statusCode: 409 });
      }
      /**
       * A deactivated login is not a login they can use.
       *
       * Deleting an account deactivates it now rather than destroying it, and
       * the employee keeps pointing at it so the deactivation can be undone.
       * Refusing a new login on the strength of that reference would lock the
       * employee out on the basis of an account nobody can sign in to — the
       * same trap the hard delete used to set, arrived at from the other side.
       *
       * The old row is left where it is, still holding the person's history.
       * Only the employee's pointer moves.
       */
      employee.user = null;
    }

    const email = (input.email ?? employee.email ?? "").toLowerCase();
    if (!email) throw Object.assign(new Error("An email is required to create a login"), { statusCode: 400 });

    const role = await Role.findById(input.role);
    if (!role) throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    assertRoleAssignable(role);
    if (role.isSystemRole) {
      throw Object.assign(new Error("This role cannot be assigned"), { statusCode: 403 });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) throw Object.assign(new Error("A user with this email already exists"), { statusCode: 409 });

    const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();

    const user = await User.create({
      name: employee.name,
      email,
      password: temporaryPassword,
      role: input.role,
      organization: employee.organization ?? getOrgId(),
      designation: employee.designation,
      workSchedule: employee.workSchedule ?? null,
      status: "invited",
      mustResetPassword: true,
    });

    employee.user = user._id;
    await employee.save();

    const activateUrl = `${env.CLIENT_URL}/set-password?email=${encodeURIComponent(email)}`;
    await sendMail({
      to: email,
      subject: "Welcome to Delta HRMS — activate your account",
      html: inviteEmailHtml(employee.name, email, temporaryPassword, activateUrl),
      text: `Welcome to Delta HRMS. Sign in with ${email} / temporary password ${temporaryPassword}, then set your own password at ${activateUrl}`,
    });

    return {
      message: "Login created and an activation email was sent to the employee.",
      employee: await Employee.findById(id).populate(POP),
      loginEmail: email,
    };
  }
}
