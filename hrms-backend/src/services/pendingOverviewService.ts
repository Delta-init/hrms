import mongoose from "mongoose";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { ADAPTERS, type ApprovalModule } from "./approvalRegistry.js";
import { ApprovalInboxService, SYSTEM_SCOPE, STALE_AFTER_DAYS, scopeFilterFor } from "./approvalInboxService.js";
import { headContactsFor } from "./departmentHeadService.js";

/**
 * What the Root portal's Pending page shows for HRMS: the numbers behind the
 * sidebar's badges, and who each request is waiting on.
 *
 * The badges are Approvals (every queue in the inbox), Leave and
 * Regularization — the last two are themselves queues inside Approvals. So the
 * kinds here are the inbox's queues, which add up to the Approvals badge, with
 * Leave and Regularization each split in two (see below) so that their two
 * halves add up to their own badges. Nothing is counted twice.
 *
 * Totals come from the inbox's own summary, read with the system scope, which
 * is exactly what a Super Admin's sidebar asks. Who a request waits on is then
 * resolved per record, by the same rules that decide who may act on it:
 *
 *   1. An offer can only be released by a Super Admin.
 *   2. A correction past the month's allowance belongs to the requester's
 *      reporting manager (`escalatedTo`), and nobody else but a Super Admin.
 *   3. A record part-way through an approval workflow waits on the role its
 *      current step names.
 *   4. Leave and corrections from a department with a head wait on the head(s).
 *   5. Everything else waits on whoever holds `approve` on that module.
 *
 * Cases 2 and 4 name a person; the rest wait on anyone holding a role, and
 * every active holder of that role is shown the whole of it. When nobody
 * holds the role, only a Super Admin can act, so it counts against them.
 * Super Admins are otherwise left out, as they are from every other approval
 * notice — they can decide anything, and listing them against everything
 * would hide who the work is really waiting on.
 */

/** Sidebar order: Leave, Regularization, then the other queues by their own links. */
const ORDER: ApprovalModule[] = [
  "leave", "regularization", "hiring", "offer", "agreement", "resignation", "reimbursement", "confirmation",
];

/** Keys the portal sees — stable, so changing a label here breaks nothing there. */
const KEYS: Record<ApprovalModule, string> = {
  leave: "leave_approvers",
  regularization: "regularization_approvers",
  hiring: "hiring_requisitions",
  offer: "offer_releases",
  agreement: "signed_agreements",
  resignation: "resignations",
  reimbursement: "reimbursements",
  confirmation: "confirmations",
};

/** The halves of Leave and Regularization that name a person. */
const NAMED: Partial<Record<ApprovalModule, { key: string; label: string }>> = {
  leave: { key: "leave", label: "Leave — department head" },
  regularization: { key: "regularization", label: "Regularization — manager or department head" },
};

/** The label each queue goes by on the Approvals page, or its sidebar name. */
const LABELS: Partial<Record<ApprovalModule, string>> = {
  leave: "Leave",
  regularization: "Regularization",
};

export interface PendingKind {
  key: string;
  label: string;
  total: number;
  overdue?: number;
  shared?: true;
}

export interface PendingPerson {
  id: string;
  name: string;
  email: string;
  active: boolean;
  counts: Record<string, number>;
  total: number;
}

type Doc = Record<string, unknown>;
type RoleRow = {
  _id: unknown;
  roleName?: string;
  isSystemRole?: boolean;
  organization?: unknown;
  permissions?: Record<string, { approve?: boolean } | undefined>;
};

const valueAt = (doc: Doc, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Doc)[k]), doc);

const isSuperAdminRole = (r: RoleRow) => !!r.isSystemRole && r.roleName === "Super Admin";

export async function pendingOverview(now = new Date()): Promise<{ kinds: PendingKind[]; people: PendingPerson[] }> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000);
  const summary = await new ApprovalInboxService().summary(SYSTEM_SCOPE);
  const byModule = new Map(summary.byModule.map((m) => [m.module, m]));

  const roles = await Role.find({}).select("roleName isSystemRole organization permissions").lean<RoleRow[]>();
  const superRoleIds = roles.filter(isSuperAdminRole).map((r) => r._id);
  const superAdmins = (
    await User.find({ role: { $in: superRoleIds }, status: "active" }).select("_id").lean()
  ).map((u) => String(u._id));

  /** Active holders of any of these roles in one organisation, memoised. */
  const holderCache = new Map<string, string[]>();
  const holders = async (roleIds: unknown[], org: string | null): Promise<string[]> => {
    const key = `${org ?? "-"}|${roleIds.map(String).sort().join(",")}`;
    const hit = holderCache.get(key);
    if (hit) return hit;
    const users = roleIds.length
      ? await User.find({
          role: { $in: roleIds },
          status: "active",
          ...(org ? { organization: new mongoose.Types.ObjectId(org) } : {}),
        }).select("_id").lean()
      : [];
    const ids = users.map((u) => String(u._id));
    holderCache.set(key, ids);
    return ids;
  };

  /** Roles that may approve this module in this organisation — its own and the built-ins. */
  const approvingRoles = (permissionModule: string, org: string | null) =>
    roles
      .filter((r) => !isSuperAdminRole(r))
      .filter((r) => r.permissions?.[permissionModule]?.approve)
      .filter((r) => !r.organization || !org || String(r.organization) === org)
      .map((r) => r._id);

  const headCache = new Map<string, string[]>();
  const headsOf = async (requester: string): Promise<string[]> => {
    const hit = headCache.get(requester);
    if (hit) return hit;
    const ids = (await headContactsFor(requester)).map((c) => c.userId).filter((id) => id !== requester);
    headCache.set(requester, ids);
    return ids;
  };

  // key -> person -> { n, overdue }
  const tally = new Map<string, Map<string, { n: number; overdue: number }>>();
  const add = (kind: string, people: string[], overdue: boolean) => {
    const perKind = tally.get(kind) ?? new Map<string, { n: number; overdue: number }>();
    tally.set(kind, perKind);
    for (const p of new Set(people)) {
      const t = perKind.get(p) ?? { n: 0, overdue: 0 };
      t.n += 1;
      if (overdue) t.overdue += 1;
      perKind.set(p, t);
    }
  };

  const kinds: PendingKind[] = [];

  for (const module of ORDER) {
    const a = ADAPTERS.find((x) => x.module === module)!;
    const scopeFilter = scopeFilterFor(SYSTEM_SCOPE, module) ?? {};
    const docs = await a.model
      .find({ ...a.pendingFilter, ...scopeFilter } as never)
      .select(`_id organization user escalated escalatedTo workflowStep approvalSteps ${a.raisedField}`)
      .lean<Doc[]>();

    const named = NAMED[module];
    let namedTotal = 0;
    let namedOverdue = 0;

    for (const d of docs) {
      const org = d.organization ? String(d.organization) : null;
      const raised = valueAt(d, a.raisedField) as Date | undefined;
      const overdue = !!raised && new Date(raised) < cutoff;
      const requester = d.user ? String(d.user) : null;

      // 2. Past the allowance: the reporting manager's, by name.
      if (named && module === "regularization" && d.escalated && d.escalatedTo) {
        namedTotal++; if (overdue) namedOverdue++;
        add(named.key, [String(d.escalatedTo)], overdue);
        continue;
      }

      // 1. Offers: Super Admins only.
      if (module === "offer") {
        add(KEYS[module], superAdmins, overdue);
        continue;
      }

      // 3. Mid-workflow: whoever holds the current step's role.
      const steps = d.approvalSteps as Array<{ order: number; role?: unknown }> | undefined;
      const step = d.workflowStep ? steps?.find((s) => s.order === d.workflowStep) : undefined;
      if (step?.role) {
        const people = await holders([step.role], org);
        add(KEYS[module], people.length ? people : superAdmins, overdue);
        continue;
      }

      // 4. A department head, for the queues heads may decide.
      if (named && requester) {
        const heads = await headsOf(requester);
        if (heads.length) {
          namedTotal++; if (overdue) namedOverdue++;
          add(named.key, heads, overdue);
          continue;
        }
      }

      // 5. Anyone holding approve on the module.
      const people = await holders(approvingRoles(a.permissionModule, org), org);
      add(KEYS[module], people.length ? people : superAdmins, overdue);
    }

    const s = byModule.get(module);
    const total = s?.count ?? docs.length;
    const stale = s?.stale ?? 0;
    if (named) {
      kinds.push({ key: named.key, label: named.label, total: namedTotal, overdue: namedOverdue });
    }
    kinds.push({
      key: KEYS[module],
      label: LABELS[module] ?? a.label,
      total: Math.max(0, total - namedTotal),
      overdue: Math.max(0, stale - namedOverdue),
      shared: true,
    });
  }

  // People, by login.
  const ids = new Set<string>();
  for (const perKind of tally.values()) for (const id of perKind.keys()) ids.add(id);
  const users = await User.find({ _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) } })
    .select("name email status")
    .lean<Array<{ _id: unknown; name?: string; email?: string; status?: string }>>();

  const people: PendingPerson[] = [];
  for (const u of users) {
    const id = String(u._id);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const k of kinds) {
      const t = tally.get(k.key)?.get(id);
      if (!t?.n) continue;
      counts[k.key] = t.n;
      total += t.n;
      if (t.overdue) counts[`${k.key}_overdue`] = t.overdue;
    }
    if (!total) continue;
    people.push({
      id,
      name: String(u.name ?? ""),
      email: String(u.email ?? "").toLowerCase(),
      active: u.status === "active",
      counts,
      total,
    });
  }
  people.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));

  return { kinds, people };
}
