import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import type { CreateRoleInput, UpdateRoleInput } from "../validations/roleValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { searchRegex, parsePagination } from "../utils/query.js";

export class RoleService {
  async createRole(input: CreateRoleInput) {
    const existing = await Role.findOne({ roleName: input.roleName.trim() });
    if (existing) {
      throw Object.assign(new Error("Role name already exists"), { statusCode: 409 });
    }

    return Role.create(input);
  }

  async getRoles(query: PaginationQuery) {
    const { page, limit, skip } = parsePagination(query, 10, 100);

    const filter: Record<string, unknown> = {};
    if (query.search) {
      filter.roleName = searchRegex(query.search);
    }

    if (query.isSystemRole !== undefined) {
      filter.isSystemRole = query.isSystemRole === "true";
    }

    const sortField = query.sortBy ?? "createdAt";
    const sortOrder = query.sortOrder === "asc" ? 1 : -1;

    const [roles, total] = await Promise.all([
      Role.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Role.countDocuments(filter),
    ]);

    return { roles, pagination: buildPagination(total, page, limit) };
  }

  async getRoleById(id: string) {
    const role = await Role.findById(id);
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }
    return role;
  }

  async updateRole(id: string, input: UpdateRoleInput) {
    const role = await Role.findById(id);
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }

    if (role.isSystemRole && role.roleName === "Super Admin") {
      if (input.roleName && input.roleName !== "Super Admin") {
        throw Object.assign(new Error("Cannot rename the Super Admin role"), { statusCode: 403 });
      }
    }

    if (input.roleName && input.roleName !== role.roleName) {
      const existing = await Role.findOne({ roleName: input.roleName.trim(), _id: { $ne: id } });
      if (existing) {
        throw Object.assign(new Error("Role name already exists"), { statusCode: 409 });
      }
    }

    Object.assign(role, input);
    await role.save();
    return role;
  }

  async deleteRole(id: string) {
    const role = await Role.findById(id);
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }

    if (role.isSystemRole) {
      throw Object.assign(new Error("System roles cannot be deleted"), { statusCode: 403 });
    }

    const usersWithRole = await User.countDocuments({ role: id });
    if (usersWithRole > 0) {
      throw Object.assign(
        new Error(`Cannot delete role: ${usersWithRole} user(s) are assigned to this role`),
        { statusCode: 400 }
      );
    }

    await Role.findByIdAndDelete(id);
    return { message: "Role deleted successfully" };
  }

  async getAllRolesSimple() {
    return Role.find({}).select("roleName description isSystemRole").sort({ roleName: 1 }).lean();
  }
}
