import "dotenv/config";
import mongoose from "mongoose";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
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

    console.log("✅ Seeding complete!");
  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
