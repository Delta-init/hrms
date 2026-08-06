import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { assertRoleAssignable } from "./roleService.js";
import { Resignation } from "../models/Resignation.js";
import type { CreateEmployeeInput, UpdateEmployeeInput, UpdateMyProfileInput, CreateLoginInput } from "../validations/employeeValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { randomBytes } from "node:crypto";

interface EmployeeQuery extends PaginationQuery {
  excludeTerminated?: string;
  department?: string;
  employmentType?: string;
}

const POP = [
  { path: "department", select: "name code" },
  { path: "workSchedule", select: "name timeZone loginTime logoutTime" },
  { path: "user", select: "name email" },
  { path: "reportingTo", select: "name employeeCode designation email" },
];

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
    if (query.department) filter.department = query.department;
    if (query.employmentType) filter.employmentType = query.employmentType;

    const sortable = new Set(["name", "employeeCode", "designation", "status", "joiningDate", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Employee.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Employee.countDocuments(filter),
    ]);
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
    return Employee.findById(id).populate(POP);
  }

  /** Self-service — the caller edits their own personal-information sections only. */
  async updateMyProfile(userId: string, input: UpdateMyProfileInput) {
    const employee = await Employee.findOne(scoped({ user: userId }));
    if (!employee) throw Object.assign(new Error("No employee is linked to your account"), { statusCode: 404 });
    return this.update(String(employee._id), input as UpdateEmployeeInput);
  }

  async remove(id: string) {
    const record = await Employee.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
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
    if (employee.user) throw Object.assign(new Error("This employee already has a login account"), { statusCode: 409 });

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
