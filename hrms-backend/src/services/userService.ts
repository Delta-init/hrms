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

    await User.findOneAndDelete(scoped({ _id: id }));

    // Release any employee that pointed at this login. Left behind, the
    // reference is worse than useless: createLogin reads the raw field, sees an
    // id and refuses with "already has a login account", while every read
    // populates the same field to null and offers to create one — so the
    // employee is shown the only action that would help and denied it.
    await Employee.updateMany(scoped({ user: id }), { $set: { user: null } });

    return { message: "User deleted successfully" };
  }
}
