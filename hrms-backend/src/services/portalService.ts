import crypto from "node:crypto";
import mongoose from "mongoose";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { HRMS_MODULES } from "../types/index.js";
import type { ModulePermissions } from "../types/index.js";

/**
 * Answering the Root portal's questions about this server's people.
 *
 * The portal decides who may open what across the estate. It could already
 * sign somebody in here, but it could not see what it had done: the role it
 * recorded was whatever an administrator typed into a box, nothing checked it
 * against HRMS, and the two could drift apart for months.
 *
 * Unlike the CRMs, this server holds several organizations, so every question
 * is asked about one of them. The portal says which; a guess would answer
 * about the wrong company's staff.
 */

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/** Which organization, insisted upon rather than assumed. */
async function resolveOrg(remoteOrgId?: string) {
  if (!remoteOrgId) {
    throw httpError(
      "This server holds more than one organization, so the portal must say which — set HRMS_REMOTE_ORG_ID on its side.",
      400,
    );
  }
  if (!mongoose.isValidObjectId(remoteOrgId)) {
    throw httpError(`"${remoteOrgId}" is not a valid organization id`, 400);
  }
  const org = await Organization.findById(remoteOrgId).select("name");
  if (!org) throw httpError("No such organization on this server", 404);
  return org;
}

export interface PortalRole {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
}

/**
 * Permissions as a flat list the portal can show.
 *
 * Stored here as a map of module to six booleans, which is right for this
 * application and meaningless to another. "payroll:approve" reads the same
 * anywhere, and the portal shows it beside the role so that choosing one is a
 * decision about what somebody will be able to do rather than a guess from
 * its name.
 */
function flatten(permissions: Record<string, ModulePermissions> | undefined): string[] {
  const out: string[] = [];
  for (const mod of HRMS_MODULES) {
    const p = permissions?.[mod];
    if (!p) continue;
    for (const action of ["view", "create", "edit", "delete", "approve", "export"] as const) {
      if (p[action]) out.push(`${mod}:${action}`);
    }
  }
  return out;
}

/**
 * The roles available to one organization.
 *
 * Its own, plus the built-ins every tenant shares — a new organization is
 * provisioned with no roles of its own, so listing only what it owns would
 * report that it has none and leave the portal offering nothing.
 */
export async function listRolesForPortal(remoteOrgId?: string): Promise<{
  organization: string;
  roles: PortalRole[];
}> {
  const org = await resolveOrg(remoteOrgId);
  const roles = await Role.find({
    $or: [{ organization: org._id }, { organization: null }],
  })
    .sort({ roleName: 1 })
    .lean();

  return {
    organization: org.name,
    roles: roles.map((r) => ({
      // This server identifies a role by its name and has no separate stable
      // key; inventing one here would be an identifier nothing else knows.
      key: r.roleName,
      name: r.roleName,
      description: r.description ?? "",
      permissions: flatten(r.permissions as Record<string, ModulePermissions> | undefined),
      isSystem: Boolean(r.isSystemRole),
    })),
  };
}

export interface PortalUserState {
  exists: boolean;
  inOrganization: boolean;
  name: string;
  email: string;
  status: string;
  membershipStatus: string | null;
  roleKey: string | null;
  roleName: string | null;
  permissions: string[];
  lastLoginAt: string | null;
}

/**
 * What an account actually holds here, right now.
 *
 * "Does not exist" is an answer, not an error: the portal asks this about
 * everybody it knows and most will have no account here. A 404 would make the
 * ordinary case look like a fault and bury the real ones.
 *
 * An address is unique across this whole server, so somebody can exist and
 * belong to another organization. That is reported rather than hidden — it is
 * the more interesting finding, and treating it as "no account" would invite
 * creating a second one that cannot be created.
 */
export async function describeUserForPortal(input: {
  email: string;
  remoteOrgId?: string;
}): Promise<PortalUserState> {
  const org = await resolveOrg(input.remoteOrgId);
  const email = input.email.toLowerCase().trim();
  if (!email) throw httpError("email is required", 400);

  const blank: PortalUserState = {
    exists: false, inOrganization: false, name: "", email, status: "",
    membershipStatus: null, roleKey: null, roleName: null, permissions: [], lastLoginAt: null,
  };

  const user = await User.findOne({ email }).populate("role").lean();
  if (!user) return blank;

  const here = String(user.organization ?? "") === String(org._id);
  const role = user.role as unknown as
    { roleName?: string; permissions?: Record<string, ModulePermissions> } | null;

  return {
    exists: true,
    inOrganization: here,
    name: user.name ?? "",
    email: user.email,
    status: user.status ?? "",
    membershipStatus: here ? user.status ?? null : null,
    roleKey: here ? role?.roleName ?? null : null,
    roleName: here ? role?.roleName ?? null : null,
    permissions: here ? flatten(role?.permissions) : [],
    lastLoginAt: null,
  };
}

/** The role, matched the way a person would write it, within this tenant. */
async function findRole(orgId: mongoose.Types.ObjectId, name: string) {
  const wanted = name.trim();
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const role = await Role.findOne({
    roleName: new RegExp(`^${escaped}$`, "i"),
    $or: [{ organization: orgId }, { organization: null }],
  });
  if (role) return role;

  const available = (
    await Role.find({ $or: [{ organization: orgId }, { organization: null }] })
      .select("roleName")
      .lean()
  )
    .map((r) => r.roleName)
    .join(", ");
  throw httpError(`No role "${wanted}" here. Available: ${available}.`, 400);
}

/**
 * Change what somebody is here, because the portal said so.
 *
 * Only ever within the organization named, and creates nothing. Provisioning
 * is its own call; an edit that created accounts as a side effect would turn
 * a typo in an email address into a second person.
 */
export async function setUserRoleFromPortal(input: {
  email: string;
  role?: string;
  status?: string;
  remoteOrgId?: string;
}): Promise<{ detail: string; roleKey: string; membershipStatus: string }> {
  const org = await resolveOrg(input.remoteOrgId);
  const email = input.email.toLowerCase().trim();
  if (!email) throw httpError("email is required", 400);
  if (!input.role && !input.status) {
    throw httpError("Nothing to change: give a role, a status, or both", 400);
  }

  const user = await User.findOne({ email });
  if (!user) throw httpError(`${email} has no account on this server — create one first`, 404);
  if (String(user.organization ?? "") !== String(org._id)) {
    throw httpError(`${email} belongs to a different organization on this server`, 409);
  }

  const changes: string[] = [];

  if (input.role) {
    const role = await findRole(org._id, input.role);
    if (String(user.role) !== String(role._id)) {
      user.role = role._id;
      changes.push(`role to ${role.roleName}`);
    }
  }

  if (input.status) {
    const status = input.status.trim().toLowerCase();
    if (!["active", "inactive", "invited"].includes(status)) {
      throw httpError(`"${status}" is not a status here`, 400);
    }
    if (user.status !== status) {
      user.status = status as typeof user.status;
      changes.push(`status to ${status}`);
    }
  }

  if (changes.length) await user.save();

  const finalRole = await Role.findById(user.role).select("roleName").lean();
  return {
    detail: changes.length
      ? `Changed ${email}'s ${changes.join(" and ")} in ${org.name}`
      : `${email} already held that in ${org.name}`,
    roleKey: finalRole?.roleName ?? "",
    membershipStatus: user.status ?? "active",
  };
}

/**
 * Create an account here, because a root admin asked.
 *
 * Signing in from the portal deliberately refuses an unknown person: this
 * server believes what the portal vouches for, so an account appearing
 * because a token arrived would turn a spoofed portal into an instant
 * account. That refusal stands; this is the other half, decided on purpose.
 *
 * Worth saying plainly: HRMS is where a person first exists in this estate,
 * and HR creating the employee is the start of the workflow. This is for the
 * case where somebody needs to sign in before that has happened — not a way
 * around it.
 *
 * The password is random and nobody is told it, including whoever asked for
 * the account: they arrive through the portal and never type one here.
 */
export async function provisionFromPortal(input: {
  email: string;
  name: string;
  role: string;
  remoteOrgId?: string;
}): Promise<{ created: boolean; userId: string; detail: string }> {
  const org = await resolveOrg(input.remoteOrgId);
  const email = input.email.toLowerCase().trim();
  if (!email) throw httpError("email is required", 400);

  const role = await findRole(org._id, input.role);

  const existing = await User.findOne({ email });
  if (existing) {
    // An address is unique across the server, so this is either idempotency
    // or a genuine clash with another tenant. They need different answers.
    if (String(existing.organization ?? "") === String(org._id)) {
      return {
        created: false,
        userId: String(existing._id),
        detail: `${email} already has an account in ${org.name}`,
      };
    }
    throw httpError(
      `${email} already exists on this server, in a different organization`,
      409,
    );
  }

  const user = await User.create({
    organization: org._id,
    name: input.name?.trim() || email.split("@")[0],
    email,
    password: crypto.randomBytes(24).toString("hex"),
    role: role._id,
    status: "active",
  });

  return {
    created: true,
    userId: String(user._id),
    detail: `Created ${email} in ${org.name} as ${role.roleName}`,
  };
}

export interface PortalUserSummary {
  email: string;
  exists: boolean;
  inOrganization: boolean;
  name: string;
  status: string;
  roleKey: string | null;
  roleName: string | null;
}

/**
 * At most this many addresses in one question.
 *
 * The portal asks about a page of its user list, which is twenty-five. The cap
 * is far above that so it never has to think about the limit, and low enough
 * that this endpoint cannot be turned into a way to sweep the staff of every
 * organization on this server one large request at a time.
 */
const MAX_EMAILS = 500;

/**
 * The same question as describeUserForPortal, asked about many people at once.
 *
 * The portal shows a column saying which systems each person actually has an
 * account on, across a page of its user list. Asked one at a time that is
 * twenty-five requests to each system for a single screen, so it is asked once
 * instead.
 *
 * Still scoped to one organization, for the same reason every other question
 * here is: this server holds several, and answering about the wrong company's
 * staff would be worse in bulk than singly. Somebody who exists on this server
 * but belongs to another organization comes back as not a member, exactly as
 * the single lookup reports them.
 *
 * Permissions are deliberately left out. They are the heaviest part of the
 * answer and a column showing which systems somebody is on does not use them;
 * whoever wants them opens that one person, where /user gives the full picture.
 *
 * Every address asked about comes back, including the ones with no account.
 * The portal has to tell "asked, and there is nobody" apart from "never
 * answered" — those mean opposite things on the screen, and a response that
 * simply omitted the misses would make them indistinguishable.
 */
export async function describeManyForPortal(input: {
  emails: unknown;
  remoteOrgId?: string;
}): Promise<{ accounts: PortalUserSummary[] }> {
  const org = await resolveOrg(input.remoteOrgId);

  if (!Array.isArray(input.emails)) {
    throw httpError("emails must be a list of addresses", 400);
  }

  // Normalised and de-duplicated the same way a single lookup is, so that
  // asking about "A@x.com" and "a@x.com " is one question, answered once.
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.emails) {
    if (typeof raw !== "string") continue;
    const email = raw.toLowerCase().trim();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    wanted.push(email);
  }

  if (wanted.length === 0) return { accounts: [] };
  if (wanted.length > MAX_EMAILS) {
    throw httpError(`At most ${MAX_EMAILS} addresses at a time, and ${wanted.length} were asked for`, 400);
  }

  // One query however many were asked for.
  const users = await User.find({ email: { $in: wanted } }).populate("role").lean();
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));

  return {
    accounts: wanted.map((email) => {
      const user = byEmail.get(email);
      if (!user) {
        return {
          email, exists: false, inOrganization: false,
          name: "", status: "", roleKey: null, roleName: null,
        };
      }
      const here = String(user.organization ?? "") === String(org._id);
      const role = user.role as unknown as { roleName?: string } | null;
      return {
        email,
        exists: true,
        inOrganization: here,
        name: user.name ?? "",
        status: user.status ?? "",
        roleKey: here ? role?.roleName ?? null : null,
        roleName: here ? role?.roleName ?? null : null,
      };
    }),
  };
}
