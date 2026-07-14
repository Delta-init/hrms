import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, signTicket, verifyTicket } from "../utils/jwt.js";
import type { LoginInput, ChangePasswordInput, SetPasswordInput, CompleteProfileInput } from "../validations/authValidation.js";
import type { IUser, IRole } from "../types/index.js";
import { scoped } from "../utils/orgContext.js";
import { missingRequiredDocs } from "../config/documentRequirements.js";
import { publicUrl } from "./uploadService.js";

export class AuthService {
  async login(input: LoginInput) {
    const user = await User.findOne({ email: input.email.toLowerCase() })
      .select("+password")
      .populate("role")
      .populate("organization", "name code logo settings");

    if (!user) {
      throw Object.assign(new Error("Invalid email or password"), { statusCode: 401 });
    }

    if (user.status === "inactive") {
      throw Object.assign(new Error("Your account has been deactivated"), { statusCode: 403 });
    }

    const isPasswordValid = await user.comparePassword(input.password);
    if (!isPasswordValid) {
      throw Object.assign(new Error("Invalid email or password"), { statusCode: 401 });
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
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    const userObj = user.toJSON() as unknown as Omit<IUser, "password">;

    return { accessToken, refreshToken, user: userObj };
  }

  async refreshToken(token: string) {
    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.userId).select("status");

    if (!user || user.status === "inactive") {
      throw Object.assign(new Error("Invalid refresh token"), { statusCode: 401 });
    }

    const payload = {
      userId: decoded.userId,
      email: decoded.email,
      roleId: decoded.roleId,
    };

    const accessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    return { accessToken, refreshToken: newRefreshToken };
  }

  async getProfile(userId: string) {
    const user = await User.findById(userId).populate("role").populate("organization", "name code logo settings");
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
    await user.save();

    return { message: "Password changed successfully" };
  }

  /**
   * First-password / invite-accept flow. An invited user sets their real
   * password using the temporary one the admin issued.
   */
  async setPassword(input: SetPasswordInput) {
    const user = await User.findOne({ email: input.email.toLowerCase() })
      .select("+password")
      .populate("role")
      .populate("organization", "name code logo settings");

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
    await user.save();

    const payload = {
      userId: user._id.toString(),
      email: user.email,
      roleId: (user.role as { _id: { toString(): string } })._id.toString(),
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
    const payload = { userId: user._id.toString(), email: user.email, roleId };
    return { accessToken: signAccessToken(payload), refreshToken: signRefreshToken(payload) };
  }

  /** Admin requests a short-lived ticket to impersonate a target user. */
  async startImpersonation(impersonatorId: string, targetId: string) {
    if (impersonatorId === targetId) {
      throw Object.assign(new Error("You cannot impersonate yourself"), { statusCode: 400 });
    }
    const [admin, target] = await Promise.all([
      User.findById(impersonatorId).select("name"),
      User.findById(targetId).populate("role"),
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
      const restoreTicket = signTicket({ kind: "restore", userId: decoded.impersonatorId }, "12h");
      return {
        accessToken,
        refreshToken,
        user: target.toJSON() as unknown as Omit<IUser, "password">,
        impersonatedBy: { id: decoded.impersonatorId, name: decoded.impersonatorName, restoreTicket },
      };
    }

    if (decoded.kind === "restore") {
      const admin = await User.findById(decoded.userId).populate("role");
      if (!admin) throw Object.assign(new Error("Session cannot be restored"), { statusCode: 401 });
      const { accessToken, refreshToken } = this.tokensFor(admin);
      return { accessToken, refreshToken, user: admin.toJSON() as unknown as Omit<IUser, "password"> };
    }

    throw Object.assign(new Error("Unknown ticket"), { statusCode: 400 });
  }
}
