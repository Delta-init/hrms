import mongoose from "mongoose";
import type { AuthenticatedRequest, HrmsModule, IRole, PermissionAction } from "../../types/index.js";
import { hasPermission } from "../../middleware/permissions.js";
import { getOrgId } from "../../utils/orgContext.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { User } from "../../models/User.js";
import { Role } from "../../models/Role.js";
import { DgoProgram } from "../../models/DgoProgram.js";
import { departmentsHeadedBy, headContactsFor } from "../departmentHeadService.js";
import { ensureDgoSetup } from "./dgoSettingsService.js";
import { dayIn } from "./dgoMath.js";
import type { DgoStage } from "./dgoDefaults.js";

/**
 * Who is asking, as DGO Points sees them: their organisation and its time zone,
 * their own employee record, the departments they head, and their DGO
 * permissions. Every DGO service takes one of these, so authorisation is decided
 * in the services (and tested there) rather than only at the route.
 */
export interface DgoViewer {
  userId: string;
  name: string;
  orgId: string;
  tz: string;
  role: IRole | undefined;
  superAdmin: boolean;
  employee: { _id: string; name: string; department: string | null } | null;
  headOf: string[];
}

import { httpError } from "./dgoErrors.js";
export { httpError };

const DGO_MODULES: HrmsModule[] = ["dgoApprovals", "dgoBudgets", "dgoSettings", "dgoAudit", "dgoRewards"];

export const can = (v: DgoViewer, module: HrmsModule, action: PermissionAction): boolean =>
  v.superAdmin || hasPermission(v.role, module, action);

/** Holds any DGO permission at all — staff who must see DGO Points before it opens to everyone. */
export const hasAnyDgoPermission = (v: DgoViewer): boolean =>
  v.superAdmin || DGO_MODULES.some((m) => (["view", "create", "edit", "approve", "delete", "export"] as PermissionAction[]).some((a) => hasPermission(v.role, m, a)));

export async function viewerFrom(user: NonNullable<AuthenticatedRequest["user"]>): Promise<DgoViewer> {
  const role = user.role;
  const superAdmin = Boolean(role?.isSystemRole && role.roleName === "Super Admin");
  const orgId = getOrgId();
  if (!orgId) throw httpError("Pick an organisation first — DGO Points runs per organisation", 400);
  const [org, login, employee, headOf] = await Promise.all([
    Organization.findById(orgId).select("timeZone").lean<{ timeZone?: string }>(),
    User.findById(user.userId).select("name").lean<{ name?: string }>(),
    Employee.findOne({ organization: orgId, user: user.userId }).select("name department").lean<{ _id: unknown; name: string; department?: unknown }>(),
    departmentsHeadedBy(user.userId),
  ]);
  await ensureDgoSetup(orgId, dayIn(org?.timeZone || "Asia/Dubai"));
  return {
    userId: String(user.userId),
    name: login?.name || user.email,
    orgId,
    tz: org?.timeZone || "Asia/Dubai",
    role,
    superAdmin,
    employee: employee ? { _id: String(employee._id), name: employee.name, department: employee.department ? String(employee.department) : null } : null,
    headOf,
  };
}

export async function programOf(orgId: string) {
  return DgoProgram.findOne({ organization: orgId }).lean<{ openToEmployees: boolean; revenueDepartments: unknown[] }>();
}

/** Switched on for everyone in this organisation. Until then a department head is just another employee here. */
export async function isOpen(orgId: string): Promise<boolean> {
  return Boolean((await programOf(orgId))?.openToEmployees);
}

/* ───────────── Who it is open to (Phase 4: a pilot group) ───────────── */

export interface Audience { audience: "everyone" | "pilot"; pilotDepartments: string[]; pilotEmployees: string[] }

export async function audienceOf(orgId: string): Promise<Audience> {
  const p = await DgoProgram.findOne({ organization: orgId }).select("audience pilotDepartments pilotEmployees")
    .lean<{ audience?: string; pilotDepartments?: unknown[]; pilotEmployees?: unknown[] }>();
  return {
    audience: p?.audience === "pilot" ? "pilot" : "everyone",
    pilotDepartments: (p?.pilotDepartments ?? []).map(String),
    pilotEmployees: (p?.pilotEmployees ?? []).map(String),
  };
}

/** In the group DGO Points is open to: everybody, or a pilot department or named pilot person. */
export const inAudience = (a: Audience, emp: { _id: unknown; department?: unknown }): boolean =>
  a.audience === "everyone" || a.pilotEmployees.includes(String(emp._id)) || (emp.department != null && a.pilotDepartments.includes(String(emp.department)));

/** An Employee filter for the group (an empty one for everybody). */
export const audienceFilter = (a: Audience): Record<string, unknown> =>
  a.audience === "everyone" ? {} : { $or: [{ _id: { $in: a.pilotEmployees.map(oid) } }, { department: { $in: a.pilotDepartments.map(oid) } }] };

/**
 * May see the employee pages: staff with a DGO permission and Super Admins
 * always; everybody else once it is open — and, during a pilot, only people in
 * the pilot group or heading a pilot department.
 */
export async function canUse(v: DgoViewer): Promise<boolean> {
  if (hasAnyDgoPermission(v)) return true;
  if (!(await isOpen(v.orgId))) return false;
  const a = await audienceOf(v.orgId);
  if (a.audience === "everyone") return true;
  if (v.employee && inAudience(a, { _id: v.employee._id, department: v.employee.department })) return true;
  return v.headOf.some((d) => a.pilotDepartments.includes(d));
}

/**
 * The viewer the automatic feeds act as (the nightly KPI import): no login, no
 * permissions, no departments — whatever it records goes through the same
 * checks as anybody's, and shows as made by `name`.
 */
export const systemViewer = (orgId: string, tz: string, name: string): DgoViewer => ({
  userId: null as unknown as string, name, orgId, tz, role: undefined, superAdmin: false, employee: null, headOf: [],
});

export async function assertCanUse(v: DgoViewer): Promise<void> {
  if (!(await canUse(v))) throw httpError("DGO Points isn't open yet", 403);
}

/**
 * Record points for this person: never yourself; HR (dgoApprovals.create) or a
 * Super Admin for anyone; a head for their own department once DGO Points is open.
 */
export function whyCannotRecordFor(v: DgoViewer, emp: { _id: unknown; user?: unknown; department?: unknown }, open: boolean): string | null {
  if ((v.employee && v.employee._id === String(emp._id)) || (emp.user && String(emp.user) === v.userId)) {
    return "You can't record points for yourself";
  }
  if (can(v, "dgoApprovals", "create")) return null;
  if (!open) return "DGO Points isn't open yet";
  if (emp.department && v.headOf.includes(String(emp.department))) return null;
  return "You can record points only for people in a department you head";
}

export const canRecordAwards = (v: DgoViewer, open: boolean) => can(v, "dgoApprovals", "create") || (open && v.headOf.length > 0);
export const canLookUpWallets = (v: DgoViewer) => can(v, "dgoBudgets", "view") || can(v, "dgoAudit", "view");

/* Phase 2 */
export const canManageRewards = (v: DgoViewer) => can(v, "dgoRewards", "create") || can(v, "dgoRewards", "edit") || can(v, "dgoRewards", "delete");
export const canFulfil = (v: DgoViewer) => can(v, "dgoRewards", "approve");
export const canSeeFulfilment = (v: DgoViewer) => can(v, "dgoRewards", "view") || canFulfil(v);
export const canRunAchievers = (v: DgoViewer) => can(v, "dgoSettings", "edit");
export const canVerifyAchievers = (v: DgoViewer) => can(v, "dgoBudgets", "approve");
export const canApproveAchievers = (v: DgoViewer) => can(v, "dgoSettings", "approve");
export const canReviewAchievers = (v: DgoViewer) =>
  canRunAchievers(v) || canVerifyAchievers(v) || canApproveAchievers(v) || can(v, "dgoSettings", "view") || can(v, "dgoBudgets", "view");
/** Sees every department on the leaderboard whatever its visibility: DGO staff. */
export const seesWholeLeaderboard = (v: DgoViewer) =>
  can(v, "dgoApprovals", "view") || can(v, "dgoApprovals", "approve") || can(v, "dgoBudgets", "view") || can(v, "dgoSettings", "view") || can(v, "dgoAudit", "view");

/** Logins holding a permission in this organisation (active users only). Best-effort, for telling people something waits. */
export async function usersWith(orgId: string, module: HrmsModule, action: PermissionAction): Promise<string[]> {
  const roles = await Role.find({ [`permissions.${module}.${action}`]: true, $or: [{ organization: orgId }, { organization: null }] }).select("_id").lean();
  if (!roles.length) return [];
  const users = await User.find({ organization: orgId, role: { $in: roles.map((r) => r._id) }, status: "active" }).select("_id").lean();
  return users.map((u) => String(u._id));
}

export interface DecidableEvent {
  status: string;
  stage: DgoStage | null;
  employee: unknown;
  user?: unknown;
  department?: unknown;
  departmentName?: string | null;
  submittedBy?: unknown;
}

/**
 * Why this person may not approve or reject the request now, or null when they may.
 * Nobody decides points for themselves or a request they recorded — a Super Admin
 * included: separation of duties is a different control from the role check a
 * Super Admin bypasses.
 */
export function whyCannotDecide(v: DgoViewer, ev: DecidableEvent): string | null {
  if (ev.status !== "pending") return "Already decided";
  if ((v.employee && v.employee._id === String(ev.employee)) || (ev.user && String(ev.user) === v.userId)) {
    return "These points are for you, so someone else decides";
  }
  if (ev.submittedBy && v.userId && String(ev.submittedBy) === v.userId) return "You recorded this, so someone else decides";
  switch (ev.stage) {
    case "head":
      if (v.superAdmin || (ev.department && v.headOf.includes(String(ev.department)))) return null;
      return `Waiting for the head of ${ev.departmentName || "their department"}`;
    case "hr":
      return can(v, "dgoApprovals", "approve") ? null : "Waiting for HR";
    case "finance":
      return can(v, "dgoBudgets", "approve") ? null : "Waiting for finance";
    default:
      // Approved at every step but not yet posted (a failure while posting): finance or a Super Admin posts it.
      return can(v, "dgoBudgets", "approve") ? null : "Approved — being posted";
  }
}

/** Logins to tell that something waits at a step. Best-effort; an empty list just means nobody is told. */
export async function approverUserIds(orgId: string, stage: DgoStage | null, employeeUser: unknown): Promise<string[]> {
  if (stage === "head") {
    if (!employeeUser) return [];
    return (await headContactsFor(String(employeeUser))).map((c) => c.userId);
  }
  const path = stage === "finance" || stage === null ? "permissions.dgoBudgets.approve" : "permissions.dgoApprovals.approve";
  const roles = await Role.find({ [path]: true, $or: [{ organization: orgId }, { organization: null }] }).select("_id").lean();
  if (!roles.length) return [];
  const users = await User.find({ organization: orgId, role: { $in: roles.map((r) => r._id) }, status: "active" }).select("_id").lean();
  return users.map((u) => String(u._id));
}

export async function departmentHasHead(departmentId: unknown): Promise<boolean> {
  if (!departmentId) return false;
  const d = await Department.findById(departmentId).select("leader coLeaders").lean<{ leader?: unknown; coLeaders?: unknown[] }>();
  return Boolean(d?.leader) || Boolean(d?.coLeaders?.length);
}

export const oid = (id: unknown) => new mongoose.Types.ObjectId(String(id));
export const isObjectId = (id: unknown): id is string => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
