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
  "cards",
  "resignations",
  "loans",
  "salaryIncrements",
  "organizations",
  "users",
  "roles",
  "settings",
] as const;

export type HrmsModule = (typeof HRMS_MODULES)[number];

export type PermissionsMap = {
  [K in HrmsModule]?: ModulePermissions;
};

// ─── Organization (multi-tenancy) ───────────────────────────────────────────
export interface IOrganizationSettings {
  currency?: string;
  timeZone?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  mailFrom?: string;
}

export interface IOrganization extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;
  logo?: string;
  status: "active" | "inactive";
  settings: IOrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
}

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
  /** Tenant this user belongs to. Null for the global Super Admin. */
  organization?: Types.ObjectId | IOrganization | null;
  designation?: string;
  /** Assigned work schedule (shift, region, leave calendar). */
  workSchedule?: Types.ObjectId | IWorkSchedule | null;
  status: "active" | "inactive" | "invited";
  mustResetPassword: boolean;
  profileCompleted: boolean;
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
  organization?: Types.ObjectId | IOrganization | null;
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
  organization?: Types.ObjectId | IOrganization | null;
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
  organization?: Types.ObjectId | IOrganization | null;
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
export type EmployeeStatus = "active" | "probation" | "on_leave" | "notice_period" | "terminated";
export type Title = "mr" | "mrs" | "ms" | "dr";
export type Gender = "male" | "female" | "other";
export type MaritalStatus = "married" | "unmarried";
export type EmployeeLocation = "india" | "dubai";

/** Document categories collected during onboarding (location-driven). */
export type DocumentType =
  | "passport"
  | "visa_copy"
  | "aadhaar"
  | "photo"
  | "education_certificate"
  | "experience_certificate";

export interface IEmployeeDocument {
  type: DocumentType;
  fileName?: string;
  fileKey: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: Date;
}

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
export interface IFamilyMember {
  name?: string;
  relation?: string;
  dob?: Date | null;
  phone?: string;
}
export interface IPassport {
  passportNumber?: string;
  country?: string;
  issueDate?: Date | null;
  expiryDate?: Date | null;
}
export interface IVisa {
  country?: string;
  type?: string;
  issueDate?: Date | null;
  expiryDate?: Date | null;
}

export interface IEmployee extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
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
  location?: EmployeeLocation;
  /** Monthly base salary (used to prefill payslips). */
  salary?: number;
  currency?: string;
  /** Profile/portal photo — R2 object key of the uploaded "photo" document. */
  photo?: string;
  /** Uploaded onboarding documents (passport, visa, certificates, …). */
  documents?: IEmployeeDocument[];

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
  noticePeriodDays?: number;
  reportingTo?: Types.ObjectId | IEmployee | IUser | null;
  reportingToKind?: "Employee" | "User";

  // ── Bank / education / addresses / emergency ──
  bank?: IBankDetails;
  education?: IEducation[];
  currentAddress?: IAddress;
  permanentAddress?: IAddress;
  emergencyContacts?: IEmergencyContact[];
  familyMembers?: IFamilyMember[];
  passport?: IPassport;
  visa?: IVisa;

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
  organization?: Types.ObjectId | IOrganization | null;
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
  organization?: Types.ObjectId | IOrganization | null;
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
  organization?: Types.ObjectId | IOrganization | null;
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
  organization?: Types.ObjectId | IOrganization | null;
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

// ─── Card ───────────────────────────────────────────────────────────────────
export type CardStatus = "active" | "expired";

export interface ICard extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  cardNumber: string;
  name: string;
  /** The login account this card is issued to. */
  client: Types.ObjectId | IUser;
  issueDate?: Date | null;
  expiryDate?: Date | null;
  notes?: string;
  /** Virtual — "expired" when expiryDate is in the past, else "active". */
  status?: CardStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Resignation & Notice Period ────────────────────────────────────────────
export type ResignationStatus = "pending" | "accepted" | "rejected" | "withdrawn" | "relieved";
export type ResignationType =
  | "resignation"
  | "termination"
  | "retirement"
  | "end_of_contract"
  | "absconding";
export type PaymentType = "cash" | "bank_transfer" | "cheque";

export interface IResignation extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  /** Login account of the employee, if any (for convenience). */
  user?: Types.ObjectId | IUser | null;
  resignationType: ResignationType;
  resignationDate: Date;
  /** When false, notice is waived — last working day is immediate. */
  noticeRequired: boolean;
  noticePeriodDays: number;
  lastWorkingDay: Date;
  reason?: string;
  status: ResignationStatus;
  // ── Exit details ──
  leavingDate?: Date | null;
  finalSettlement?: number | null;
  left?: boolean;
  noticePeriodServed?: boolean;
  // ── Leave settlement ──
  leaveSalaryPaid?: boolean;
  ticketAllowancePaid?: boolean;
  paymentType?: PaymentType | null;
  remarks?: string;
  reviewedBy?: Types.ObjectId | IUser | null;
  reviewedAt?: Date | null;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Loan ────────────────────────────────────────────────────────────────────
export type LoanStatus = "active" | "closed" | "cancelled";
export interface ILoan extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  amount: number;
  purpose?: string;
  disbursedDate?: Date | null;
  installments: number;
  monthlyDeduction: number;
  amountRepaid: number;
  status: LoanStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── One-time payment / deduction ────────────────────────────────────────────
export type OneTimeKind = "payment" | "deduction";
export interface IOneTimeAdjustment extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  kind: OneTimeKind;
  label: string;
  amount: number;
  /** Payout month (YYYY-MM). */
  month: string;
  notes?: string;
  applied: boolean;
  payslip?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Payroll checklist ───────────────────────────────────────────────────────
export interface IPayrollChecklistItem extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  label: string;
  link?: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Salary increment ────────────────────────────────────────────────────────
export interface ISalaryIncrement extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  previousSalary: number;
  newSalary: number;
  /** Payout month the raise takes effect (YYYY-MM). */
  effectiveMonth: string;
  reason?: string;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}
