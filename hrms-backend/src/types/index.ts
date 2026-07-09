import type { Request } from "express";
import type { Document, Types } from "mongoose";

// ─── Permission Actions ────────────────────────────────────────────────────────
export type PermissionAction = "view" | "create" | "edit" | "delete" | "approve" | "export";

export interface ModulePermissions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  export: boolean;
}

// All available modules in the HRMS. Phase 1 implements users + roles;
// the rest are declared so roles/permissions are future-proof.
export const HRMS_MODULES = [
  "dashboard",
  "employees",
  "departments",
  "attendance",
  "leave",
  "regularization",
  "payroll",
  "workSchedules",
  "users",
  "roles",
  "settings",
] as const;

export type HrmsModule = (typeof HRMS_MODULES)[number];

export type PermissionsMap = {
  [K in HrmsModule]?: ModulePermissions;
};

// ─── Role ─────────────────────────────────────────────────────────────────────
export interface IRole extends Document {
  _id: Types.ObjectId;
  roleName: string;
  description?: string;
  permissions: PermissionsMap;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── User ─────────────────────────────────────────────────────────────────────
export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: Types.ObjectId | IRole;
  designation?: string;
  /** Assigned work schedule (shift, region, leave calendar). */
  workSchedule?: Types.ObjectId | IWorkSchedule | null;
  status: "active" | "inactive" | "invited";
  mustResetPassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: string;
  email: string;
  roleId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    roleId: string;
    role?: IRole;
  };
}

// ─── API Response ─────────────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: unknown;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: string;
  role?: string;
  isSystemRole?: string;
}

// ─── Attendance ─────────────────────────────────────────────────────────────
export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "half_day"
  | "on_leave"
  | "holiday"
  | "weekend"
  | "wfh";

/** A single check-in / check-out punch pair within a day. */
export interface IAttendanceSession {
  checkIn: Date; // login instant (UTC)
  checkOut?: Date | null; // logout instant (UTC); null while still clocked in
}

export interface IAttendance extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId | IUser;
  /** Calendar day this record belongs to (midnight of the local day, stored UTC). */
  date: Date;
  /** IANA time zone / "time region" the times are measured in, e.g. "Asia/Dubai". */
  timeZone: string;
  /** Day's first login and last logout (also mirrored across `sessions`). */
  checkIn?: Date | null;
  checkOut?: Date | null;
  /** All punch pairs for the day (supports breaks / multiple sessions). */
  sessions: Types.DocumentArray<IAttendanceSession & Document>;
  status: AttendanceStatus;
  /** Total worked minutes across sessions (computed on save). */
  workedMinutes: number;
  /** Minutes late vs the expected shift start (0 if on time). */
  lateMinutes: number;
  /** Linked leave request when status is "on_leave". */
  leaveRequest?: Types.ObjectId | ILeaveRequest;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
  computeWorkedMinutes(): number;
}

// ─── Leave Calendar: Holidays ───────────────────────────────────────────────
export type HolidayType = "public" | "company" | "optional";

export interface IHoliday extends Document {
  _id: Types.ObjectId;
  name: string;
  /** The holiday date (midnight of the local day, stored UTC). */
  date: Date;
  /** Region the holiday applies to. */
  timeZone: string;
  type: HolidayType;
  /** Repeats on the same month/day every year. */
  recurring: boolean;
  /** Optional tag — the work schedule this holiday belongs to (its leave calendar). Null = global. */
  workSchedule?: Types.ObjectId | IWorkSchedule | null;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Department ─────────────────────────────────────────────────────────────
/** A person reference that may point to either an Employee or a User. */
export type PersonKind = "Employee" | "User";

export interface IDepartmentMember {
  kind: PersonKind;
  ref: Types.ObjectId | IEmployee | IUser;
}

export interface IDepartment extends Document {
  _id: Types.ObjectId;
  name: string;
  code?: string;
  description?: string;
  /** Team leader — an Employee or a User (polymorphic). */
  leader?: Types.ObjectId | IEmployee | IUser | null;
  leaderKind?: PersonKind;
  /** Members — each an Employee or a User. */
  members: Types.DocumentArray<IDepartmentMember & Document>;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

// ─── Employee ───────────────────────────────────────────────────────────────
export type EmploymentType = "full_time" | "part_time" | "contract" | "intern";
export type EmployeeStatus = "active" | "probation" | "on_leave" | "terminated";
export type Title = "mr" | "mrs" | "ms" | "dr";
export type Gender = "male" | "female" | "other";
export type MaritalStatus = "married" | "unmarried";

export interface IEducation {
  qualification?: string;
  from?: string;
  to?: string;
  institute?: string;
}
export interface IAddress {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}
export interface IEmergencyContact {
  name?: string;
  relation?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  phoneNumber?: string;
  email?: string;
}
export interface IBankDetails {
  bankAccountNumber?: string;
  ibanIfsc?: string;
  bankName?: string;
  nameInBank?: string;
}

export interface IEmployee extends Document {
  _id: Types.ObjectId;
  employeeCode: string;
  name: string;
  email?: string;
  phone?: string;
  department?: Types.ObjectId | IDepartment | null;
  designation?: string;
  workSchedule?: Types.ObjectId | IWorkSchedule | null;
  /** Optional link to a login account. */
  user?: Types.ObjectId | IUser | null;
  employmentType: EmploymentType;
  joiningDate?: Date | null;
  status: EmployeeStatus;
  location?: string;
  /** Monthly base salary (used to prefill payslips). */
  salary?: number;
  currency?: string;

  // ── Personal ──
  title?: Title;
  gender?: Gender;
  personalEmail?: string;
  mobileNumber?: string;
  dob?: Date | null;
  bloodGroup?: string;
  nationality?: string;
  maritalStatus?: MaritalStatus;

  // ── Employment ──
  oldCompanyExperience?: string;
  confirmationDate?: Date | null;
  probationPeriodDays?: number;
  reportingTo?: Types.ObjectId | IEmployee | IUser | null;
  reportingToKind?: "Employee" | "User";

  // ── Bank / education / addresses / emergency ──
  bank?: IBankDetails;
  education?: IEducation[];
  currentAddress?: IAddress;
  permanentAddress?: IAddress;
  emergencyContacts?: IEmergencyContact[];

  createdAt: Date;
  updatedAt: Date;
}

// ─── Attendance Regularization ──────────────────────────────────────────────
export type RegularizationType =
  | "missing_checkin"
  | "missing_checkout"
  | "wrong_time"
  | "absent_correction";

export type RegularizationStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface IRegularization extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId | IUser;
  date: Date;
  timeZone: string;
  type: RegularizationType;
  requestedCheckIn?: Date | null;
  requestedCheckOut?: Date | null;
  reason?: string;
  status: RegularizationStatus;
  reviewedBy?: Types.ObjectId | IUser | null;
  reviewedAt?: Date | null;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Payslip ────────────────────────────────────────────────────────────────
export type PayslipStatus = "draft" | "issued" | "paid";

export interface IPayslipLine {
  label: string;
  amount: number;
}

export interface IPayslip extends Document {
  _id: Types.ObjectId;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  /** Pay period, "YYYY-MM". */
  month: string;
  monthDate: Date;
  currency: string;
  earnings: Types.DocumentArray<IPayslipLine & Document>;
  deductions: Types.DocumentArray<IPayslipLine & Document>;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  workingDays?: number;
  paidDays?: number;
  lopDays?: number;
  status: PayslipStatus;
  issuedBy?: Types.ObjectId | IUser | null;
  issuedAt?: Date | null;
  paidAt?: Date | null;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Work Schedule (shift + region + leave calendar) ────────────────────────
export interface IWorkSchedule extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  /** IANA region / time zone, e.g. "Asia/Dubai". */
  timeZone: string;
  /** Expected shift start, "HH:mm". */
  loginTime: string;
  /** Expected shift end, "HH:mm". */
  logoutTime: string;
  /** Working weekdays, 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  /** Subset of workDays that are half-days (0 = Sunday … 6 = Saturday). */
  halfDays: number[];
  /** Late tolerance (minutes) before an arrival is counted as late. */
  graceMinutes: number;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

// ─── Leave Calendar: Leave Requests ─────────────────────────────────────────
export type LeaveType =
  | "annual"
  | "sick"
  | "casual"
  | "unpaid"
  | "maternity"
  | "paternity"
  | "wfh";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ILeaveRequest extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId | IUser;
  type: LeaveType;
  startDate: Date;
  endDate: Date;
  /** Half-day leave on a single date. */
  halfDay: boolean;
  /** Number of leave days (accounts for half-days). */
  days: number;
  timeZone: string;
  reason?: string;
  status: LeaveStatus;
  reviewedBy?: Types.ObjectId | IUser;
  reviewedAt?: Date | null;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}
