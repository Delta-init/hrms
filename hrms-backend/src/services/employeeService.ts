import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import type { CreateEmployeeInput, UpdateEmployeeInput, CreateLoginInput } from "../validations/employeeValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

interface EmployeeQuery extends PaginationQuery {
  department?: string;
  employmentType?: string;
}

const POP = [
  { path: "department", select: "name code" },
  { path: "workSchedule", select: "name timeZone loginTime logoutTime" },
  { path: "user", select: "name email" },
  { path: "reportingTo", select: "name employeeCode designation" },
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

export class EmployeeService {
  async create(input: CreateEmployeeInput) {
    const existing = await Employee.findOne({ employeeCode: input.employeeCode.trim().toUpperCase() });
    if (existing) throw Object.assign(new Error("Employee code already exists"), { statusCode: 409 });
    const emp = await Employee.create(clean(input));
    return Employee.findById(emp._id).populate(POP);
  }

  async list(query: EmployeeQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) {
      const rx = new RegExp(query.search, "i");
      filter.$or = [{ name: rx }, { employeeCode: rx }, { email: rx }, { designation: rx }];
    }
    if (query.status) filter.status = query.status;
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
    const record = await Employee.findById(id).populate(POP);
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateEmployeeInput) {
    const record = await Employee.findById(id);
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    if (input.employeeCode && input.employeeCode.toUpperCase() !== record.employeeCode) {
      const dupe = await Employee.findOne({ employeeCode: input.employeeCode.trim().toUpperCase(), _id: { $ne: id } });
      if (dupe) throw Object.assign(new Error("Employee code already exists"), { statusCode: 409 });
    }

    Object.assign(record, clean(input));
    await record.save();
    return Employee.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Employee.findByIdAndDelete(id);
    if (!record) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    return { message: "Employee deleted successfully" };
  }

  /**
   * Provision a login account for an employee. Creates an invited User with
   * mustResetPassword = true, so the employee sets their own password on first
   * login (via the /auth/set-password activation flow), then links it.
   */
  async createLogin(id: string, input: CreateLoginInput) {
    const employee = await Employee.findById(id);
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    if (employee.user) throw Object.assign(new Error("This employee already has a login account"), { statusCode: 409 });

    const email = (input.email ?? employee.email ?? "").toLowerCase();
    if (!email) throw Object.assign(new Error("An email is required to create a login"), { statusCode: 400 });

    const role = await Role.findById(input.role);
    if (!role) throw Object.assign(new Error("Role not found"), { statusCode: 404 });

    const existingUser = await User.findOne({ email });
    if (existingUser) throw Object.assign(new Error("A user with this email already exists"), { statusCode: 409 });

    const user = await User.create({
      name: employee.name,
      email,
      password: input.temporaryPassword,
      role: input.role,
      designation: employee.designation,
      workSchedule: employee.workSchedule ?? null,
      status: "invited",
      mustResetPassword: true,
    });

    employee.user = user._id;
    await employee.save();

    return {
      message: "Login created. Share the temporary password — the employee sets their own on first sign-in.",
      employee: await Employee.findById(id).populate(POP),
      loginEmail: email,
    };
  }
}
