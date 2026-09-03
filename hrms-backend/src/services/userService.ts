import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { Employee } from "../models/Employee.js";
import { assertRoleAssignable } from "./roleService.js";
import type { CreateUserInput, UpdateUserInput } from "../validations/userValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

export class UserService {
  async createUser(input: CreateUserInput) {
    const existingUser = await User.findOne({ email: input.email.toLowerCase() });
    if (existingUser) {
      throw Object.assign(new Error("Email already exists"), { statusCode: 409 });
    }

    const role = await Role.findById(input.role);
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }
    assertRoleAssignable(role);
    // Guard against privilege escalation: system roles (e.g. Super Admin) are
    // bootstrapped by the seed only and can never be assigned via the API.
    if (role.isSystemRole) {
      throw Object.assign(new Error("This role cannot be assigned"), { statusCode: 403 });
    }

    const user = await User.create({ ...input, organization: getOrgId(), email: input.email.toLowerCase() });
    return User.findById(user._id)
      .populate("role")
      .populate("workSchedule", "name timeZone loginTime logoutTime workDays graceMinutes");
  }

  async getUsers(query: PaginationQuery) {
    const { page, limit, skip } = parsePagination(query, 10, 100);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) {
      const regex = searchRegex(query.search);
      filter.$or = [{ name: regex }, { email: regex }, { designation: regex }];
    }

    if (query.status && ["active", "inactive", "invited"].includes(query.status)) {
      filter.status = query.status;
    }

    if (query.role) {
      filter.role = query.role;
    }

    const sortField = query.sortBy ?? "createdAt";
    const sortOrder = query.sortOrder === "asc" ? 1 : -1;

    const [users, total] = await Promise.all([
      User.find(filter)
        .populate("role", "roleName")
        .populate("workSchedule", "name timeZone loginTime logoutTime workDays graceMinutes")
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return { users, pagination: buildPagination(total, page, limit) };
  }

  async getUserById(id: string) {
    const user = await User.findOne(scoped({ _id: id }))
      .populate("role")
      .populate("workSchedule", "name timeZone loginTime logoutTime workDays graceMinutes");
    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }
    return user;
  }

  async updateUser(id: string, input: UpdateUserInput) {
    const user = await User.findOne(scoped({ _id: id }));
    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }

    if (input.email && input.email !== user.email) {
      const existing = await User.findOne({ email: input.email.toLowerCase(), _id: { $ne: id } });
      if (existing) {
        throw Object.assign(new Error("Email already in use"), { statusCode: 409 });
      }
    }

    if (input.role) {
      const role = await Role.findById(input.role);
      if (!role) {
        throw Object.assign(new Error("Role not found"), { statusCode: 404 });
      }
      assertRoleAssignable(role);
      if (role.isSystemRole) {
        throw Object.assign(new Error("This role cannot be assigned"), { statusCode: 403 });
      }
    }

    // Handle password update separately to trigger the pre-save hook
    if (input.password) {
      user.password = input.password;
    }

    Object.assign(user, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.email !== undefined && { email: input.email.toLowerCase() }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.designation !== undefined && { designation: input.designation }),
      ...(input.workSchedule !== undefined && { workSchedule: input.workSchedule || null }),
      ...(input.status !== undefined && { status: input.status }),
    });

    await user.save();
    // The same schedule lives on the employee record, where HR edits it. Kept
    // in step from this side too, so the two cannot drift apart again
    // depending on which screen somebody happened to use.
    if (input.workSchedule !== undefined) {
      await Employee.updateOne({ user: user._id }, { $set: { workSchedule: input.workSchedule || null } });
    }
    return User.findById(id)
      .populate("role")
      .populate("workSchedule", "name timeZone loginTime logoutTime workDays graceMinutes");
  }

  async deleteUser(id: string, requestingUserId: string) {
    if (id === requestingUserId) {
      throw Object.assign(new Error("You cannot delete your own account"), { statusCode: 400 });
    }

    const user = await User.findOne(scoped({ _id: id })).populate("role");
    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }

    const role = user.role as { isSystemRole?: boolean; roleName?: string };
    if (role?.isSystemRole && role?.roleName === "Super Admin") {
      throw Object.assign(new Error("Super Admin user cannot be deleted"), { statusCode: 403 });
    }

    /**
     * Deactivated, not destroyed.
     *
     * This used to be a hard delete that also nulled the employee's reference
     * in the same breath, which left nothing anywhere saying the account had
     * existed — not even on the employee record that had pointed at it. The
     * only trace was the id still carried by whatever the person had done:
     * their leave, their payslips, their attendance. Recovering one meant
     * reading those back and rebuilding the row by hand from the migration
     * spreadsheets, and the database is a standalone with no oplog behind it,
     * so there was nothing else to fall back on.
     *
     * `inactive` already means exactly this everywhere else. Sign-in refuses
     * it, refresh tokens are refused, and every scheduled job that mails people
     * already filters it out — so the account goes as quiet as a deleted one
     * while staying recoverable by flipping one field back.
     */
    user.status = "inactive";
    // Retires every outstanding access and refresh token, so an open session
    // does not keep working until it happens to expire.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    // The employee keeps pointing at it, which is what makes this reversible.
    // `createLogin` would otherwise refuse a replacement for an employee whose
    // login was deactivated, so it releases the link itself when it finds one
    // that is no longer usable.
    return { message: "User deactivated. Their records and history are kept." };
  }
}
