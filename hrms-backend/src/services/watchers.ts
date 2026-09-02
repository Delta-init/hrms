import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { getOrgId } from "../utils/orgContext.js";
import { headContactFor } from "./departmentHeadService.js";
import type { HrmsModule } from "../types/index.js";

/**
 * Everybody who ought to hear about one request.
 *
 * Resolved from permissions rather than from a role name. "HR Manager" is what
 * the role happens to be called today, and a system that looks for that string
 * stops working the day somebody renames it or adds a second approver role —
 * silently, with no error, which is the worst way for a notification system to
 * fail. Asking "who holds approve on this module" survives both.
 *
 * The requester's department head is added on top, because they can now decide
 * these and would otherwise be the one person who has to go and look.
 *
 * Scoped to the caller's organisation. A Super Admin can decide anything
 * anywhere, but being told about every tenant's leave is not the same as being
 * able to approve it, and would make the bell useless within a week.
 */
export async function watchersFor(module: HrmsModule, requesterUserId?: string): Promise<string[]> {
  const orgId = getOrgId();
  const out = new Set<string>();

  try {
    // Roles are a small collection, and the alternative — a query per role —
    // is worse. Filtered in memory because permissions is a nested map that
    // Mongo cannot index usefully on a per-module key.
    const roles = await Role.find({ $or: [{ organization: orgId }, { organization: null }] })
      .select("permissions roleName isSystemRole")
      .lean<Array<{ _id: unknown; permissions?: Record<string, Record<string, boolean>>; roleName?: string; isSystemRole?: boolean }>>();

    const approving = roles
      // Super Admin approves everything everywhere, which is exactly why they
      // are not told about everything everywhere.
      .filter((r) => !(r.isSystemRole && r.roleName === "Super Admin"))
      .filter((r) => r.permissions?.[module]?.approve)
      .map((r) => r._id);

    if (approving.length) {
      const users = await User.find({
        role: { $in: approving },
        ...(orgId ? { organization: orgId } : {}),
        status: { $ne: "inactive" },
      })
        .select("_id")
        .lean();
      for (const u of users) out.add(String(u._id));
    }

    if (requesterUserId) {
      const head = await headContactFor(requesterUserId);
      if (head) out.add(head.userId);
      // Their own request is never theirs to hear about as an approver.
      out.delete(String(requesterUserId));
    }
  } catch (err) {
    console.error("🔔 watcher lookup failed:", err instanceof Error ? err.message : err);
  }

  return [...out];
}
