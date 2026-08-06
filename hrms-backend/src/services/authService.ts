import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { AuditLog } from "../models/AuditLog.js";
import { ConsumedTicket } from "../models/ConsumedTicket.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, signTicket, verifyTicket } from "../utils/jwt.js";
import type { ImpersonationTicket } from "../utils/jwt.js";
import type { LoginInput, ChangePasswordInput, SetPasswordInput, CompleteProfileInput } from "../validations/authValidation.js";
import type { IUser, IRole } from "../types/index.js";
import { scoped } from "../utils/orgContext.js";
import { missingRequiredDocs } from "../config/documentRequirements.js";
import { publicUrl } from "./uploadService.js";

/**
 * A valid bcrypt hash (of a random string) compared against when no user
 * matches, so an unknown email costs the same time as a wrong password and
 * can't be distinguished by response latency.
 */
const DUMMY_HASH = "$2a$12$vvxe7fcKuugHyGlVDs9h5u71eN2FnKco8UCqdd6BpcubJhQy0MPY2";

export class AuthService {
  async login(input: LoginInput) {
    const user = await User.findOne({ email: input.email.toLowerCase() })
      .select("+password")
      .populate("role")
      .populate("organization", "name code logo settings.currency settings.timeZone");

    if (!user) {
      // Burn an equivalent bcrypt round before failing — see DUMMY_HASH.
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw Object.assign(new Error("Invalid email or password"), { statusCode: 401 });
    }

    const isPasswordValid = await user.comparePassword(input.password);
    if (!isPasswordValid) {
      throw Object.assign(new Error("Invalid email or password"), { statusCode: 401 });
    }

    // Checked only after the password is proven — otherwise the distinct 403
    // tells an unauthenticated caller that the address is a real account.
    if (user.status === "inactive") {
      throw Object.assign(new Error("Your account has been deactivated"), { statusCode: 403 });
    }

    // Invited users who haven't set a password yet must go through set-password.
    if (user.mustResetPassword) {
      throw Object.assign(
        new Error("You must set a new password before signing in"),
        { statusCode: 403, code: "MUST_RESET_PASSWORD" }
      );
    }

    const payload = {
      userId: user._id.toString(),
      email: user.email,
      roleId: (user.role as { _id: { toString(): string } })._id.toString(),
      tokenVersion: user.tokenVersion ?? 0,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    const userObj = user.toJSON() as unknown as Omit<IUser, "password">;

    return { accessToken, refreshToken, user: userObj };
  }

  async refreshToken(token: string) {
    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.userId).select("status role tokenVersion");

    if (!user || user.status === "inactive") {
      throw Object.assign(new Error("Invalid refresh token"), { statusCode: 401 });
    }
    // A bumped tokenVersion (logout, password change, admin revoke) retires
    // every token issued before it, including this refresh token.
    if ((decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      throw Object.assign(new Error("Invalid refresh token"), { statusCode: 401 });
    }

    const payload = {
      userId: decoded.userId,
      email: decoded.email,
      // Re-read from the user rather than copying the old claim, so a role
      // reassignment takes effect on the next refresh instead of persisting
      // for the refresh token's full lifetime.
      roleId: String(user.role),
      tokenVersion: user.tokenVersion ?? 0,
    };

    const accessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Invalidate every outstanding token for this user. */
  async logout(userId: string) {
    await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
    return { message: "Signed out successfully" };
  }

  async getProfile(userId: string) {
    const user = await User.findById(userId).populate("role").populate("organization", "name code logo settings.currency settings.timeZone");
    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }
    return user;
  }

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await User.findById(userId).select("+password");
    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }

    const isValid = await user.comparePassword(input.currentPassword);
    if (!isValid) {
      throw Object.assign(new Error("Current password is incorrect"), { statusCode: 400 });
    }

    user.password = input.newPassword;
    // Retire sessions issued against the old password; the caller gets a fresh
    // pair back so changing your own password doesn't sign you out.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    const payload = {
      userId: user._id.toString(),
      email: user.email,
      roleId: String(user.role),
      tokenVersion: user.tokenVersion,
    };
    return {
      message: "Password changed successfully",
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
    };
  }

  /**
   * First-password / invite-accept flow. An invited user sets their real
   * password using the temporary one the admin issued.
   */
  async setPassword(input: SetPasswordInput) {
    const user = await User.findOne({ email: input.email.toLowerCase() })
      .select("+password")
      .populate("role")
      .populate("organization", "name code logo settings.currency settings.timeZone");

    if (!user) {
      throw Object.assign(new Error("Invalid email or temporary password"), { statusCode: 401 });
    }

    const isValid = await user.comparePassword(input.temporaryPassword);
    if (!isValid) {
      throw Object.assign(new Error("Invalid email or temporary password"), { statusCode: 401 });
    }

    user.password = input.newPassword;
    user.mustResetPassword = false;
    if (user.status === "invited") user.status = "active";
    // Setting a password retires anything issued against the temporary one.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    const payload = {
      userId: user._id.toString(),
      email: user.email,
      roleId: (user.role as { _id: { toString(): string } })._id.toString(),
      tokenVersion: user.tokenVersion,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const userObj = user.toJSON() as unknown as Omit<IUser, "password">;

    return { accessToken, refreshToken, user: userObj };
  }

  // ── Onboarding ───────────────────────────────────────────────────────────
  /**
   * The caller's linked employee (to prefill the onboarding form). If they have
   * no employee to onboard, mark them complete so the gate stops prompting.
   */
  async getMyProfile(userId: string) {
    const employee = await Employee.findOne(scoped({ user: userId }))
      .populate("department", "name code")
      .populate("reportingTo", "name employeeCode");
    if (!employee) {
      await User.findByIdAndUpdate(userId, { profileCompleted: true });
      return { employee: null, profileCompleted: true, photoUrl: "" };
    }
    const user = await User.findById(userId).select("profileCompleted");
    return {
      employee,
      profileCompleted: !!user?.profileCompleted,
      photoUrl: employee.photo ? publicUrl(employee.photo) : "",
    };
  }

  /** Save the mandatory onboarding details onto the caller's own employee. */
  async completeProfile(userId: string, input: CompleteProfileInput) {
    const employee = await Employee.findOne(scoped({ user: userId }));
    if (!employee) {
      throw Object.assign(
        new Error("No employee is linked to your account. Please contact your administrator."),
        { statusCode: 400 }
      );
    }
    // Enforce location-driven document collection: onboarding cannot complete
    // until every required document for the employee's work location is present.
    if (employee.location) {
      const missing = missingRequiredDocs(
        employee.location,
        employee.documents ?? []
      );
      if (missing.length) {
        throw Object.assign(
          new Error(`Please upload required documents: ${missing.join(", ")}.`),
          { statusCode: 400 }
        );
      }
    }

    const { education, emergencyContact, ...rest } = input;
    if (rest.personalEmail === "") rest.personalEmail = undefined;
    Object.assign(employee, rest, {
      education: [education],
      emergencyContacts: [emergencyContact],
    });
    await employee.save();

    const user = await User.findByIdAndUpdate(
      userId,
      { profileCompleted: true },
      { new: true }
    ).populate("role");
    return user!.toJSON() as unknown as Omit<IUser, "password">;
  }

  // ── Impersonation ──────────────────────────────────────────────────────────
  private tokensFor(user: IUser) {
    const roleId = (user.role as { _id?: { toString(): string } })?._id?.toString() ?? String(user.role);
    const payload = { userId: user._id.toString(), email: user.email, roleId, tokenVersion: user.tokenVersion ?? 0 };
    return { accessToken: signAccessToken(payload), refreshToken: signRefreshToken(payload) };
  }

  /** Admin requests a short-lived ticket to impersonate a target user. */
  async startImpersonation(impersonatorId: string, targetId: string) {
    if (impersonatorId === targetId) {
      throw Object.assign(new Error("You cannot impersonate yourself"), { statusCode: 400 });
    }
    const [admin, target] = await Promise.all([
      User.findById(impersonatorId).select("name"),
      // Scope to the caller's org so an admin can't impersonate another tenant's user.
      User.findOne(scoped({ _id: targetId })).populate("role"),
    ]);
    if (!target) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    if (target.status === "inactive") {
      throw Object.assign(new Error("Cannot impersonate a deactivated user"), { statusCode: 400 });
    }
    if ((target.role as IRole)?.isSystemRole) {
      throw Object.assign(new Error("You cannot impersonate an administrator"), { statusCode: 403 });
    }
    const ticket = signTicket(
      { kind: "impersonate", targetUserId: targetId, impersonatorId, impersonatorName: admin?.name ?? "Admin" },
      "60s"
    );
    return { ticket, target: { id: targetId, name: target.name } };
  }

  /**
   * Record a ticket's jti so it can only be redeemed once. The unique index
   * turns a concurrent or replayed second redemption into a duplicate-key
   * error, which we surface as a plain 401.
   */
  private async consumeTicket(decoded: ImpersonationTicket) {
    if (!decoded.jti) {
      throw Object.assign(new Error("Invalid or expired ticket"), { statusCode: 401 });
    }
    try {
      await ConsumedTicket.create({
        jti: decoded.jti,
        expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 4 * 60 * 60 * 1000),
      });
    } catch {
      throw Object.assign(new Error("This ticket has already been used"), { statusCode: 401 });
    }
  }

  /** Exchange a ticket for a session (used by the NextAuth impersonate provider). */
  async exchange(ticket: string) {
    let decoded;
    try {
      decoded = verifyTicket(ticket);
    } catch {
      throw Object.assign(new Error("Invalid or expired ticket"), { statusCode: 401 });
    }

    if (decoded.kind === "impersonate") {
      const target = await User.findById(decoded.targetUserId).populate("role");
      if (!target || target.status === "inactive") {
        throw Object.assign(new Error("Cannot impersonate this user"), { statusCode: 401 });
      }
      if ((target.role as IRole)?.isSystemRole) {
        throw Object.assign(new Error("You cannot impersonate an administrator"), { statusCode: 403 });
      }
      const { accessToken, refreshToken } = this.tokensFor(target);
      // Carries the target forward so the eventual restore can log who the
      // session was impersonating, without re-deriving it from anywhere else.
      const restoreTicket = signTicket(
        { kind: "restore", userId: decoded.impersonatorId, targetUserId: decoded.targetUserId },
        "4h"
      );
      await AuditLog.create({
        organization: target.organization,
        action: "impersonation.start",
        actor: decoded.impersonatorId,
        actorName: decoded.impersonatorName ?? "Admin",
        target: target._id,
        targetName: target.name,
      });
      return {
        accessToken,
        refreshToken,
        user: target.toJSON() as unknown as Omit<IUser, "password">,
        impersonatedBy: { id: decoded.impersonatorId, name: decoded.impersonatorName, restoreTicket },
      };
    }

    if (decoded.kind === "restore") {
      // Burn the ticket first: the unique index on jti makes a replayed copy
      // fail here rather than mint a second admin session.
      await this.consumeTicket(decoded);

      const admin = await User.findById(decoded.userId).populate("role");
      if (!admin) throw Object.assign(new Error("Session cannot be restored"), { statusCode: 401 });
      // Same re-checks the impersonate branch does — an admin deactivated or
      // demoted during the impersonation must not get their session back.
      if (admin.status === "inactive") {
        throw Object.assign(new Error("Session cannot be restored"), { statusCode: 401 });
      }
      const { accessToken, refreshToken } = this.tokensFor(admin);
      const target = decoded.targetUserId ? await User.findById(decoded.targetUserId).select("name organization") : null;
      await AuditLog.create({
        organization: admin.organization,
        action: "impersonation.end",
        actor: admin._id,
        actorName: admin.name,
        target: target?._id ?? null,
        targetName: target?.name ?? null,
      });
      return { accessToken, refreshToken, user: admin.toJSON() as unknown as Omit<IUser, "password"> };
    }

    throw Object.assign(new Error("Unknown ticket"), { statusCode: 400 });
  }
}
