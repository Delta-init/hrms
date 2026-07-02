// ─── Permissions ──────────────────────────────────────────────────────────────
export type PermissionAction = "view" | "create" | "edit" | "delete" | "approve" | "export";

export interface ModulePermissions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  export: boolean;
}

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

export const MODULE_LABELS: Record<HrmsModule, string> = {
  dashboard: "Dashboard",
  employees: "Employees",
  departments: "Departments",
  attendance: "Attendance",
  leave: "Leave",
  payroll: "Payroll",
  regularization: "Regularization",
  workSchedules: "Work Schedules",
  users: "Users",
  roles: "Roles & Permissions",
  settings: "Settings",
};

export type PermissionsMap = Partial<Record<HrmsModule, ModulePermissions>>;

// ─── Role ─────────────────────────────────────────────────────────────────────
export interface Role {
  _id: string;
  roleName: string;
  description?: string;
  permissions: PermissionsMap;
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RoleSimple = Pick<Role, "_id" | "roleName" | "description" | "isSystemRole">;

// ─── User ─────────────────────────────────────────────────────────────────────
export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role | string;
  designation?: string;
  workSchedule?: WorkScheduleSimple | string | null;
  status: "active" | "inactive" | "invited";
  mustResetPassword?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Work Schedule (shift + region + leave calendar) ─────────────────────────
export interface WorkSchedule {
  _id: string;
  name: string;
  description?: string;
  timeZone: string;
  loginTime: string;
  logoutTime: string;
  workDays: number[];
  halfDays: number[];
  graceMinutes: number;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export type WorkScheduleSimple = Pick<
  WorkSchedule,
  "_id" | "name" | "timeZone" | "loginTime" | "logoutTime" | "workDays" | "halfDays" | "graceMinutes"
>;

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ─── Department ──────────────────────────────────────────────────────────────
export type PersonKind = "Employee" | "User";

export interface PersonRef {
  _id: string;
  name: string;
  email?: string;
  employeeCode?: string;
}

export interface DepartmentMember {
  kind: PersonKind;
  ref: PersonRef | string;
}

export interface Department {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  leader?: PersonRef | string | null;
  leaderKind?: PersonKind;
  members: DepartmentMember[];
  status: "active" | "inactive";
  employeeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type DepartmentSimple = Pick<Department, "_id" | "name" | "code">;

// ─── Employee ────────────────────────────────────────────────────────────────
export type EmploymentType = "full_time" | "part_time" | "contract" | "intern";
export type EmployeeStatus = "active" | "probation" | "on_leave" | "terminated";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  probation: "Probation",
  on_leave: "On Leave",
  terminated: "Terminated",
};

export interface Employee {
  _id: string;
  employeeCode: string;
  name: string;
  email?: string;
  phone?: string;
  department?: DepartmentSimple | string | null;
  designation?: string;
  workSchedule?: WorkScheduleSimple | string | null;
  user?: { _id: string; name: string; email: string } | string | null;
  employmentType: EmploymentType;
  joiningDate?: string | null;
  status: EmployeeStatus;
  location?: string;
  salary?: number;
  currency?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: Role;
  designation?: string;
  status: "active" | "inactive" | "invited";
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

// ─── API ──────────────────────────────────────────────────────────────────────
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

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ─── Attendance ─────────────────────────────────────────────────────────────
export type AttendanceStatus =
  | "present" | "absent" | "late" | "half_day" | "on_leave" | "holiday" | "weekend" | "wfh";

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half Day",
  on_leave: "On Leave",
  holiday: "Holiday",
  weekend: "Weekend",
  wfh: "Work From Home",
};

export interface Attendance {
  _id: string;
  user: Pick<User, "_id" | "name" | "email" | "designation"> | string;
  date: string;
  timeZone: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Leave ──────────────────────────────────────────────────────────────────
export type LeaveType = "annual" | "sick" | "casual" | "unpaid" | "maternity" | "paternity" | "wfh";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "Annual",
  sick: "Sick",
  casual: "Casual",
  unpaid: "Unpaid",
  maternity: "Maternity",
  paternity: "Paternity",
  wfh: "Work From Home",
};

export interface LeaveRequest {
  _id: string;
  user: Pick<User, "_id" | "name" | "email" | "designation"> | string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  timeZone: string;
  reason?: string;
  status: LeaveStatus;
  reviewedBy?: Pick<User, "_id" | "name" | "email"> | string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Holiday (leave calendar) ────────────────────────────────────────────────
export type HolidayType = "public" | "company" | "optional";

export interface Holiday {
  _id: string;
  name: string;
  date: string;
  timeZone: string;
  type: HolidayType;
  recurring: boolean;
  workSchedule?: WorkScheduleSimple | string | null;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// Common IANA time zones for the pickers.
export const TIME_ZONES = [
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
] as const;

// ─── Attendance Regularization ───────────────────────────────────────────────
export type RegularizationType = "missing_checkin" | "missing_checkout" | "wrong_time" | "absent_correction";
export type RegularizationStatus = "pending" | "approved" | "rejected" | "cancelled";

export const REGULARIZATION_TYPE_LABELS: Record<RegularizationType, string> = {
  missing_checkin: "Missing Check-in",
  missing_checkout: "Missing Check-out",
  wrong_time: "Wrong Time",
  absent_correction: "Absent Correction",
};

export interface Regularization {
  _id: string;
  user: { _id: string; name: string; email?: string; designation?: string } | string;
  date: string;
  timeZone: string;
  type: RegularizationType;
  requestedCheckIn?: string | null;
  requestedCheckOut?: string | null;
  reason?: string;
  status: RegularizationStatus;
  reviewedBy?: { _id: string; name: string } | string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Self attendance (clock-in/out) ──────────────────────────────────────────
export interface ShiftInfo {
  shiftStart: string;
  shiftEnd: string;
  windowOpen: string;
  lateThreshold: string;
  halfDayThreshold: string;
  serverNow: string;
}

export interface AttendanceToday {
  attendance: Attendance | null;
  schedule: { timeZone: string; loginTime: string; logoutTime: string; graceMinutes: number };
  shift: ShiftInfo;
}

// ─── Payslip ─────────────────────────────────────────────────────────────────
export type PayslipStatus = "draft" | "issued" | "paid";
export const PAYSLIP_STATUS_LABELS: Record<PayslipStatus, string> = { draft: "Draft", issued: "Issued", paid: "Paid" };

export interface PayslipLine { label: string; amount: number }

export interface PayslipEmployeeRef {
  _id: string; name: string; employeeCode: string; designation?: string;
  department?: string; salary?: number; currency?: string;
}

export interface Payslip {
  _id: string;
  employee: PayslipEmployeeRef | string;
  user?: string | null;
  month: string;
  monthDate: string;
  currency: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  workingDays?: number;
  paidDays?: number;
  lopDays?: number;
  status: PayslipStatus;
  issuedBy?: { _id: string; name: string } | string | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayslipSummary {
  present: number; late: number; half: number; absent: number;
  unpaidLeaveDays: number; lopDays: number; salary: number; currency: string;
}

// ─── Department report ───────────────────────────────────────────────────────
export interface DepartmentReportMember {
  employee: { _id: string; name: string; employeeCode: string; designation?: string };
  hasUser: boolean;
  leaveDays: number;
  summary: { present: number; late: number; half_day: number; absent: number; on_leave: number; wfh: number };
  calendar: Record<string, AttendanceStatus>;
}
export interface DepartmentReport {
  department: { _id: string; name: string; code?: string; leader?: PersonRef | string | null; status: string; memberCount: number };
  month: string;
  year: number;
  daysInMonth: number;
  members: DepartmentReportMember[];
}
