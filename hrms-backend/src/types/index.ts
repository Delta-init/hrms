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
  "reimbursements",
  "assets",
  "onboardingTasks",
  "letters",
  "announcements",
  "surveys",
  "approvalWorkflows",
  "helpdesk",
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

// ─── Announcements (org-wide engagement feed) ────────────────────────────────
export type AnnouncementCategory = "general" | "policy" | "event" | "celebration";

export interface IAnnouncement extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  title: string;
  body: string;
  category: AnnouncementCategory;
  /** Pinned announcements sort above everything else. */
  pinned: boolean;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Surveys (engagement polls) ─────────────────────────────────────────────
export type SurveyQuestionType = "text" | "single_choice" | "rating";
export type SurveyStatus = "draft" | "active" | "closed";

export interface ISurveyQuestion {
  _id: Types.ObjectId;
  text: string;
  type: SurveyQuestionType;
  /** Required for "single_choice"; ignored otherwise. */
  options: string[];
  required: boolean;
}

export interface ISurvey extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  title: string;
  description?: string;
  questions: ISurveyQuestion[];
  status: SurveyStatus;
  closesAt?: Date | null;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISurveyAnswer {
  question: Types.ObjectId;
  /** String for text/single_choice, number for rating. */
  value: string | number;
}

export interface ISurveyResponse extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  survey: Types.ObjectId | ISurvey;
  user: Types.ObjectId | IUser;
  answers: ISurveyAnswer[];
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Helpdesk (employee support tickets) ────────────────────────────────────
export type HelpdeskCategory = "it" | "hr" | "payroll" | "facilities" | "other";
export type HelpdeskPriority = "low" | "medium" | "high";
export type HelpdeskStatus = "open" | "in_progress" | "resolved" | "closed";

export interface IHelpdeskComment {
  author: Types.ObjectId | IUser;
  body: string;
  at: Date;
}

export interface IHelpdeskTicket extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  subject: string;
  description: string;
  category: HelpdeskCategory;
  priority: HelpdeskPriority;
  status: HelpdeskStatus;
  createdBy: Types.ObjectId | IUser;
  assignedTo?: Types.ObjectId | IUser | null;
  comments: IHelpdeskComment[];
  resolvedAt?: Date | null;
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
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: IApprovalStepSnapshot[];
  approvalTrail?: IApprovalTrailEntry[];
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

// ─── Shift roster assignment (dated WorkSchedule assignment) ────────────────
/** Assigns a work schedule (shift) to an employee for a date range — the
 *  building block for shift rotation. The assignment in force on a given
 *  date is the one with the latest effectiveFrom on or before it whose
 *  effectiveTo (if set) is on or after it. */
export interface IRosterAssignment extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  /** Login account of the employee, if any — the field attendance actually resolves against. */
  user?: Types.ObjectId | IUser | null;
  workSchedule: Types.ObjectId | IWorkSchedule;
  effectiveFrom: Date;
  /** Null = open-ended (still in force). */
  effectiveTo?: Date | null;
  notes?: string;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Attendance penalty policy (late-arrival deductions) ────────────────────
/** Per-org rule converting repeated lateness into a payroll deduction: the
 *  first `graceLates` late arrivals in a month are free, then every further
 *  `lateBlockSize` late arrivals count as one half-day Loss-of-Pay. */
export interface IAttendancePenaltyPolicy extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  enabled: boolean;
  graceLates: number;
  lateBlockSize: number;
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
  | "wfh"
  | "comp_off";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

// ─── Approval workflow (configurable multi-step approval chains) ────────────
/** Approvable modules that can have a configurable multi-step chain — the
 *  ones sharing the same pending → approved/rejected + reviewedBy shape. */
export type ApprovableModule = "leave" | "regularization" | "reimbursements";

export interface IApprovalStep {
  order: number;
  role: Types.ObjectId | IRole;
  label?: string;
}

export interface IApprovalWorkflow extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  module: ApprovableModule;
  enabled: boolean;
  steps: IApprovalStep[];
  createdAt: Date;
  updatedAt: Date;
}

/** A step snapshotted onto an approvable record when it's created, so a later
 *  edit to the org's workflow config never changes an in-flight request. */
export interface IApprovalStepSnapshot {
  order: number;
  role: Types.ObjectId;
  roleName: string;
  label?: string;
}

/** One completed action in a record's approval chain. */
export interface IApprovalTrailEntry {
  step: number;
  roleName?: string;
  by: Types.ObjectId | IUser;
  action: "approved" | "rejected";
  note?: string;
  at: Date;
}

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
  /** Current pending step (1-indexed) in a configured approval chain; null = single-step (no workflow configured). */
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: IApprovalStepSnapshot[];
  approvalTrail?: IApprovalTrailEntry[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Leave policy (balances & accrual) ────────────────────────────────────────
export interface ILeavePolicy extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  type: LeaveType;
  /** Full-year entitlement in days. */
  annualDays: number;
  /** Days off track are pro-rated monthly through the year; if false, the
   *  full annualDays is available from the start (subject to joining date). */
  accrueMonthly: boolean;
  /** Max unused days that carry into the next year (0 = no carry-forward). */
  carryForwardLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Computed — not persisted. One employee's balance for one leave type/year. */
export interface ILeaveBalance {
  type: LeaveType;
  year: number;
  annualDays: number;
  accrued: number;
  carriedForward: number;
  used: number;
  balance: number;
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

// ─── Asset ───────────────────────────────────────────────────────────────────
export type AssetCategory = "laptop" | "phone" | "monitor" | "furniture" | "vehicle" | "sim_card" | "other";
export type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";
export type AssetStatus = "available" | "assigned" | "maintenance" | "retired";

export interface IAssetHistoryEntry {
  action: "issued" | "returned" | "sent_to_maintenance" | "retired";
  employee?: Types.ObjectId | IEmployee | null;
  date: Date;
  condition?: AssetCondition;
  notes?: string;
  by?: Types.ObjectId | IUser | null;
}

export interface IAsset extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  name: string;
  category: AssetCategory;
  assetTag: string;
  serialNumber?: string;
  purchaseDate?: Date | null;
  purchaseCost?: number;
  condition: AssetCondition;
  status: AssetStatus;
  /** Currently-holding employee, if assigned. */
  assignedTo?: Types.ObjectId | IEmployee | null;
  assignedDate?: Date | null;
  notes?: string;
  history: IAssetHistoryEntry[];
  createdBy?: Types.ObjectId | IUser | null;
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
  // ── Full & final settlement ──
  settlement?: IFinalSettlement | null;
  reviewedBy?: Types.ObjectId | IUser | null;
  reviewedAt?: Date | null;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISettlementLine {
  label: string;
  amount: number;
}
export interface IFinalSettlement {
  computedAt?: Date;
  /** Monthly Basic used as the settlement base (from the salary structure/salary). */
  basic: number;
  dayRate: number;
  tenureYears: number;
  gratuity: number;
  leaveEncashmentDays: number;
  noticeShortfallDays: number;
  earnings: ISettlementLine[];
  deductions: ISettlementLine[];
  totalEarnings: number;
  totalDeductions: number;
  netPayable: number;
  currency: string;
  settled: boolean;
  settledAt?: Date | null;
  notes?: string;
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

// ─── Salary structure (reusable template + effective-dated assignment) ───────
export type SalaryComponentType = "earning" | "deduction";
export type SalaryComponentCalc = "fixed" | "percent";
export interface ISalaryComponent {
  name: string;
  type: SalaryComponentType;
  calc: SalaryComponentCalc;
  /** Fixed amount when calc="fixed"; percentage of Basic when calc="percent". */
  value: number;
}
export interface ISalaryStructure extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  name: string;
  description?: string;
  components: ISalaryComponent[];
  status: "active" | "inactive";
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ISalaryStructureAssignment extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  structure: Types.ObjectId | ISalaryStructure;
  /** The employee's Basic pay; percent components are computed off this. */
  basicAmount: number;
  /** Month this structure takes effect (YYYY-MM). */
  effectiveMonth: string;
  notes?: string;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Reimbursement claim ─────────────────────────────────────────────────────
export type ReimbursementCategory =
  | "travel" | "food" | "accommodation" | "medical" | "communication" | "fuel" | "supplies" | "other";
export type ReimbursementStatus = "pending" | "approved" | "rejected" | "paid";
export interface IReimbursement extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  category: ReimbursementCategory;
  title: string;
  amount: number;
  /** Date the expense was incurred. */
  expenseDate: Date;
  /** Payout month the reimbursement should be paid in (YYYY-MM). */
  month: string;
  description?: string;
  receiptUrl?: string;
  status: ReimbursementStatus;
  reviewedBy?: Types.ObjectId | IUser | null;
  reviewedAt?: Date;
  reviewNote?: string;
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: IApprovalStepSnapshot[];
  approvalTrail?: IApprovalTrailEntry[];
  /** Set when the approved claim has been paid out through a payslip. */
  payslip?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Overtime ────────────────────────────────────────────────────────────────
export interface IOvertime extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  /** Date the overtime was worked. */
  date: Date;
  hours: number;
  hourlyRate: number;
  multiplier: number;
  /** hours × hourlyRate × multiplier (computed on save). */
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

// ─── Onboarding task checklists ──────────────────────────────────────────────
export type OnboardingTaskCategory = "documentation" | "it_setup" | "hr" | "facilities" | "training";
export type OnboardingAssigneeRole = "hr" | "it" | "manager" | "employee";
export type OnboardingTaskStatus = "pending" | "completed";

export interface IOnboardingTemplateTask {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  category: OnboardingTaskCategory;
  assigneeRole: OnboardingAssigneeRole;
  /** Days from the employee's joining date this task is due (may be negative — before joining). */
  dueDayOffset: number;
}

export interface IOnboardingTemplate extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  name: string;
  description?: string;
  tasks: IOnboardingTemplateTask[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOnboardingChecklistTask {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  category: OnboardingTaskCategory;
  assigneeRole: OnboardingAssigneeRole;
  dueDate?: Date | null;
  status: OnboardingTaskStatus;
  completedAt?: Date | null;
  completedBy?: Types.ObjectId | IUser | null;
}

export interface IOnboardingChecklist extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  /** Name of the template this checklist was generated from (denormalized). */
  templateName: string;
  tasks: Types.DocumentArray<IOnboardingChecklistTask & Document>;
  createdBy?: Types.ObjectId | IUser | null;
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

// ─── Letters & templates engine ──────────────────────────────────────────────
export type LetterCategory = "offer" | "appointment" | "confirmation" | "experience" | "relieving" | "warning" | "other";

/** A reusable letter body with {{merge.token}} placeholders, e.g.
 *  "Dear {{employee.name}}, ... your designation is {{employee.designation}}." */
export interface ILetterTemplate extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  name: string;
  category: LetterCategory;
  subject?: string;
  body: string;
  status: "active" | "inactive";
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A letter issued to an employee — a merge-resolved snapshot of a template
 *  at issuance time, so later template edits never change a letter already sent. */
export interface IGeneratedLetter extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  template?: Types.ObjectId | ILetterTemplate | null;
  /** Snapshot of the source template's name/category/subject at issuance time. */
  templateName: string;
  category: LetterCategory;
  subject: string;
  /** Fully merge-resolved letter body — the immutable record of what was issued. */
  content: string;
  issuedBy?: Types.ObjectId | IUser | null;
  issuedAt: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Comp-off (compensatory time off) ────────────────────────────────────────
/** One "earn" event: the employee worked a weekend/holiday and was credited a
 *  day (or half-day) of comp-off. Balance is computed on the fly as the sum
 *  of available credits minus days used by approved type="comp_off" leave —
 *  there's no separate redemption/consumption step to keep in sync. */
export interface ICompOffCredit extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  user?: Types.ObjectId | IUser | null;
  /** The off-day the employee worked to earn this credit. */
  date: Date;
  /** Days of comp-off earned (e.g. 0.5 or 1). */
  amount: number;
  reason?: string;
  status: "available" | "revoked";
  sourceAttendance?: Types.ObjectId | IAttendance | null;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}
