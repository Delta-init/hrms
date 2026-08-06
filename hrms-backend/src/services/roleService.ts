import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import type { CreateRoleInput, UpdateRoleInput } from "../validations/roleValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { getOrgId } from "../utils/orgContext.js";

/**
 * Roles a tenant may see: the shared built-ins plus its own.
 *
 * `$in: [null, orgId]` rather than `$or` — it also matches documents with no
 * `organization` key at all, which is every role that predates this field, and
 * it can't clobber a caller-supplied `$or`. An unscoped caller (Super Admin
 * with no org selected) gets `{}` and sees everything.
 */
function visibleRoles(): Record<string, unknown> {
  const orgId = getOrgId();
  return orgId ? { organization: { $in: [null, orgId] } } : {};
}

/**
 * Reject assigning a role the caller's tenant doesn't own or share.
 *
 * Without this, a tenant admin could paste another tenant's role id into a
 * create-user or create-login call and inherit permissions none of their own
 * roles grant — the list-scoping above hides such roles but doesn't stop an
 * id that was already known.
 */
export function assertRoleAssignable(role: { organization?: unknown }): void {
  const orgId = getOrgId();
  if (orgId && role.organization && String(role.organization) !== orgId) {
    throw Object.assign(new Error("Role not found"), { statusCode: 404 });
  }
}

export class RoleService {
  async createRole(input: CreateRoleInput) {
    // Scoped: an unscoped check would let one tenant's role name block another's,
    // while still correctly refusing to shadow a built-in.
    const existing = await Role.findOne({ roleName: input.roleName.trim(), ...visibleRoles() });
    if (existing) {
      throw Object.assign(new Error("Role name already exists"), { statusCode: 409 });
    }

    return Role.create({ ...input, organization: getOrgId() });
  }

  async getRoles(query: PaginationQuery) {
    const { page, limit, skip } = parsePagination(query, 10, 100);

    const filter: Record<string, unknown> = { ...visibleRoles() };
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
    const role = await Role.findOne({ _id: id, ...visibleRoles() });
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }
    return role;
  }

  async updateRole(id: string, input: UpdateRoleInput) {
    // Ownership, not visibility: a tenant can see the built-ins but editing one
    // would rewrite permissions for every tenant on the platform. 404 rather
    // than 403 so this doesn't confirm another tenant's role exists.
    const role = await Role.findOne({ _id: id, organization: getOrgId() });
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }

    if (role.isSystemRole && role.roleName === "Super Admin") {
      if (input.roleName && input.roleName !== "Super Admin") {
        throw Object.assign(new Error("Cannot rename the Super Admin role"), { statusCode: 403 });
      }
    }

    if (input.roleName && input.roleName !== role.roleName) {
      const existing = await Role.findOne({ roleName: input.roleName.trim(), _id: { $ne: id }, ...visibleRoles() });
      if (existing) {
        throw Object.assign(new Error("Role name already exists"), { statusCode: 409 });
      }
    }

    Object.assign(role, input);
    await role.save();
    return role;
  }

  async deleteRole(id: string) {
    // Ownership, as with updateRole — nobody but an unscoped Super Admin may
    // delete a shared built-in.
    const role = await Role.findOne({ _id: id, organization: getOrgId() });
    if (!role) {
      throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }

    if (role.isSystemRole) {
      throw Object.assign(new Error("System roles cannot be deleted"), { statusCode: 403 });
    }

    // Deliberately unscoped: a shared role may still be assigned in another
    // tenant, and a scoped count would let it be deleted out from under them.
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
    return Role.find(visibleRoles()).select("roleName description isSystemRole").sort({ roleName: 1 }).lean();
  }
}
