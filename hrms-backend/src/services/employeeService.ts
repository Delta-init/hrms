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
    const emp = await Employee.create({ ...clean(input), organization: getOrgId() });
    return Employee.findById(emp._id).populate(POP);
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

    const user = await User.create({
      name: employee.name,
      email,
      password: input.temporaryPassword,
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
      html: inviteEmailHtml(employee.name, email, input.temporaryPassword, activateUrl),
      text: `Welcome to Delta HRMS. Sign in with ${email} / temporary password ${input.temporaryPassword}, then set your own password at ${activateUrl}`,
    });

    return {
      message: "Login created and an activation email was sent to the employee.",
      employee: await Employee.findById(id).populate(POP),
      loginEmail: email,
    };
  }
}
