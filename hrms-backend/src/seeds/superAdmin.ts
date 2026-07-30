import "dotenv/config";
import mongoose from "mongoose";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Holiday } from "../models/Holiday.js";
import { Regularization } from "../models/Regularization.js";
import { Payslip } from "../models/Payslip.js";
import { Card } from "../models/Card.js";
import { Resignation } from "../models/Resignation.js";
import { env } from "../config/env.js";
import type { PermissionsMap } from "../types/index.js";
import { HRMS_MODULES } from "../types/index.js";

const fullAccess = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  approve: true,
  export: true,
};

const superAdminPermissions: PermissionsMap = Object.fromEntries(
  HRMS_MODULES.map((mod) => [mod, { ...fullAccess }])
) as PermissionsMap;

// HR Manager: full access to HR modules, read-only on users/roles/settings.
const hrManagerPermissions: PermissionsMap = {
  dashboard: { ...fullAccess, delete: false, approve: false },
  employees: { ...fullAccess },
  departments: { ...fullAccess },
  attendance: { ...fullAccess },
  leave: { ...fullAccess },
  regularization: { ...fullAccess },
  workSchedules: { ...fullAccess },
  cards: { ...fullAccess },
  resignations: { ...fullAccess },
  loans: { ...fullAccess },
  salaryIncrements: { ...fullAccess },
  reimbursements: { ...fullAccess },
  assets: { ...fullAccess },
  payroll: { view: true, create: true, edit: true, delete: false, approve: true, export: true },
  users: { view: true, create: true, edit: true, delete: false, approve: false, export: false },
  roles: { view: true, create: false, edit: false, delete: false, approve: false, export: false },
  settings: { view: true, create: false, edit: false, delete: false, approve: false, export: false },
};

// Employee: self-service only — clock in/out, apply for leave, file
// attendance-regularization requests, and view their own records.
const employeePermissions: PermissionsMap = {
  dashboard: { view: true, create: false, edit: false, delete: false, approve: false, export: false },
  attendance: { view: true, create: true, edit: false, delete: false, approve: false, export: false },
  leave: { view: true, create: true, edit: false, delete: false, approve: false, export: false },
  regularization: { view: true, create: true, edit: false, delete: false, approve: false, export: false },
  // create only: employees submit their own claims (New Claim) and see them via
  // My Claims (/mine needs no permission). No `view` — that exposes the org-wide
  // All Claims tab with every colleague's private expense amounts.
  reimbursements: { view: false, create: true, edit: false, delete: false, approve: false, export: false },
};

async function upsertRole(
  roleName: string,
  description: string,
  permissions: PermissionsMap,
  isSystemRole: boolean
) {
  let role = await Role.findOne({ roleName });
  if (!role) {
    role = await Role.create({ roleName, description, permissions, isSystemRole });
    console.log(`✅ Role created: ${roleName}`);
  } else {
    role.permissions = permissions;
    role.isSystemRole = isSystemRole;
    await role.save();
    console.log(`✅ Role updated: ${roleName}`);
  }
  return role;
}

async function seed() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const superAdminRole = await upsertRole(
      "Super Admin",
      "Full system access with all permissions",
      superAdminPermissions,
      true
    );
    await upsertRole(
      "HR Manager",
      "Manages employees, attendance, leave and payroll",
      hrManagerPermissions,
      false
    );
    await upsertRole(
      "Employee",
      "Standard employee self-service access",
      employeePermissions,
      false
    );

    // Create Super Admin user
    const existingUser = await User.findOne({ email: env.SUPER_ADMIN_EMAIL.toLowerCase() });
    if (!existingUser) {
      await User.create({
        name: env.SUPER_ADMIN_NAME,
        email: env.SUPER_ADMIN_EMAIL.toLowerCase(),
        password: env.SUPER_ADMIN_PASSWORD,
        role: superAdminRole._id,
        designation: "System Administrator",
        status: "active",
        mustResetPassword: false,
      });
      console.log(`✅ Super Admin user created: ${env.SUPER_ADMIN_EMAIL} (password: ${env.SUPER_ADMIN_PASSWORD})`);
    } else {
      console.log(`ℹ️  Super Admin user already exists: ${env.SUPER_ADMIN_EMAIL}`);
    }

    // Backfill: users that predate the onboarding feature (no profileCompleted
    // field yet) are marked complete so only NEW activations are prompted.
    const backfill = await User.updateMany(
      { profileCompleted: { $exists: false } },
      { $set: { profileCompleted: true } }
    );
    if (backfill.modifiedCount > 0) console.log(`✅ Marked ${backfill.modifiedCount} existing user(s) profile-complete`);

    // Default work schedules
    const schedules = [
      { name: "Dubai Day Shift", description: "Standard 9-6 shift, Dubai", timeZone: "Asia/Dubai", loginTime: "09:00", logoutTime: "18:00", workDays: [1, 2, 3, 4, 5], graceMinutes: 10 },
      { name: "Remote — IST", description: "Remote team on India Standard Time", timeZone: "Asia/Kolkata", loginTime: "10:00", logoutTime: "19:00", workDays: [1, 2, 3, 4, 5], graceMinutes: 15 },
    ];
    for (const s of schedules) {
      const exists = await WorkSchedule.findOne({ name: s.name });
      if (!exists) {
        await WorkSchedule.create(s);
        console.log(`✅ Work schedule created: ${s.name}`);
      } else {
        console.log(`ℹ️  Work schedule already exists: ${s.name}`);
      }
    }

    // ── Multi-tenancy: default organization + backfill ──────────────────────
    let org = await Organization.findOne({ code: "DELTA" });
    if (!org) {
      org = await Organization.create({
        name: "Delta International",
        code: "DELTA",
        settings: { currency: "AED", timeZone: "Asia/Dubai" },
      });
      console.log("✅ Default organization created: Delta International (DELTA)");
    }

    // Drop stale single-field unique indexes so the per-org compound ones apply.
    for (const [model, index] of [
      [Employee, "employeeCode_1"], [Card, "cardNumber_1"],
      [Department, "name_1"], [WorkSchedule, "name_1"],
    ] as const) {
      try { await model.collection.dropIndex(index); console.log(`   dropped stale index ${index}`); } catch { /* not present */ }
    }

    // Backfill every domain record that has no organization into the default org.
    const scoped = [Employee, Department, Attendance, LeaveRequest, Holiday, WorkSchedule, Regularization, Payslip, Card, Resignation];
    let total = 0;
    for (const model of scoped) {
      const res = await model.updateMany({ organization: null }, { $set: { organization: org._id } });
      total += res.modifiedCount;
    }
    // Users: assign to default org, but keep Super Admins global (null).
    await User.updateMany({ organization: null, role: { $ne: superAdminRole._id } }, { $set: { organization: org._id } });
    await User.updateMany({ role: superAdminRole._id }, { $set: { organization: null } });
    if (total > 0) console.log(`✅ Backfilled ${total} record(s) into the default organization`);

    console.log("✅ Seeding complete!");
  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
