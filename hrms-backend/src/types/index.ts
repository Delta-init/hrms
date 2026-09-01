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
  // The check-in tablet by the door. Its own module so a device account can be
  // granted the kiosk and nothing else — before this, reaching the kiosk screen
  // meant handing over `users` or `attendance`, which unlock the staff register
  // and everybody's punches along with it.
  "kiosk",
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
  "hiring",
  "confirmations",
  "letters",
  "announcements",
  "surveys",
  "approvalWorkflows",
  "helpdesk",
  "reports",
  "performance",
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
  /** Hold office staff to punching at a kiosk. See the model for why it is opt-in. */
  enforceWorkMode?: boolean;
  /** How closely remote staff are held to one browser. See the model. */
  remoteDevice?: RemoteDevicePolicy;
  /** Hold new joiners at the induction and agreements. See the model. */
  requireAgreements?: boolean;
  /** Onboarding also requires a face on file. */
  requireFaceEnrollment?: boolean;
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
  /** Owning tenant. Null = built-in role, visible to every tenant. */
  organization?: Types.ObjectId | IOrganization | null;
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
  /** When an invitation email last went out, so a stopped batch can resume. */
  invitedAt?: Date | null;
  mustResetPassword: boolean;
  profileCompleted: boolean;
  /** Bumped to invalidate every token previously issued to this user. */
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: string;
  email: string;
  roleId: string;
  /** Must match the user's current tokenVersion, else the token is revoked. */
  tokenVersion?: number;
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
/** How a punch was made. Records predating face check-in read as "web". */
export type PunchMethod = "web" | "face" | "manual";

/**
 * Provenance of a single punch. Recorded per punch rather than per session
 * because the two ends can differ — recognised at the kiosk on the way in,
 * clocked out from a desk on the way home.
 */
export interface IPunchSource {
  method: PunchMethod;
  kiosk?: Types.ObjectId | IKiosk | null;
  /** Similarity score that identified them, for auditing a disputed punch. */
  matchScore?: number | null;
  /** R2 key of the frame this punch was made from; purged on a retention job. */
  proofKey?: string | null;

  // Where the punch came from — see utils/punchContext.ts. Server-observed:
  ip?: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  userAgent?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: "mobile" | "tablet" | "desktop" | null;
  // Browser-reported, and only as trustworthy as the browser:
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  locationSource?: "gps" | "denied" | "unavailable" | "unsupported" | null;
  timeZone?: string | null;
  /** The registered browser this punch came from, when device binding is on. */
  deviceLabel?: string | null;
  /** Set when the punch did not come from the registered browser. */
  deviceAnomaly?: DeviceAnomaly | null;
}

export interface IAttendanceSession {
  checkIn: Date; // login instant (UTC)
  checkOut?: Date | null; // logout instant (UTC); null while still clocked in
  checkInSource?: IPunchSource | null;
  checkOutSource?: IPunchSource | null;
}

export interface IAttendance extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  user: Types.ObjectId | IUser;
  /** Calendar day this record belongs to (midnight of the local day, stored UTC). */
  date: Date;
  /**
   * The same day written plainly, as it reads where the person works:
   * "2026-09-01". What every date filter matches on, because `date` is a
   * different instant for each timezone and no single range covers them all.
   */
  localDay?: string | null;
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

// ─── Kiosk devices (face check-in) ──────────────────────────────────────────
export interface IKiosk extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  name: string;
  location?: string;
  /** SHA-256 of the device secret. The secret itself is shown once, at pairing. */
  tokenHash: string;
  /** Last four characters of the secret, so a device can be told apart in a list. */
  tokenHint: string;
  active: boolean;
  lastSeenAt?: Date | null;
  lastSeenIp?: string | null;
  createdBy: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Liveness challenge (kiosk anti-spoofing) ───────────────────────────────
/** A pose the kiosk asks somebody to hold. */
export type LivenessStep = "center" | "left" | "right";

export interface ILivenessChallenge extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  kiosk: Types.ObjectId | IKiosk;
  steps: LivenessStep[];
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
}

// ─── Face enrollment (kiosk attendance) ─────────────────────────────────────
export interface IFaceConsent {
  /** When the employee agreed to their face being used for attendance. */
  at: Date;
  /** Who recorded the consent — the employee, or the admin sitting with them. */
  by: Types.ObjectId | IUser;
  /** The wording they agreed to, kept verbatim so it can be shown back later. */
  text: string;
}

export interface IFaceProfile extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  user: Types.ObjectId | IUser;
  /**
   * One 512-d unit-length vector per capture. These are what recognition
   * compares against; the photos themselves are not kept.
   */
  embeddings: number[][];
  /** Model pack the embeddings came from — they are not comparable across packs. */
  modelPack: string;
  /** R2 key of a single reference photo, retained so HR can audit a disputed match. */
  referenceKey?: string | null;
  consent: IFaceConsent;
  enrolledBy: Types.ObjectId | IUser;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
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

// ─── Performance management (goals + appraisal cycles) ─────────────────────
export type PerformanceCycleStatus = "draft" | "active" | "closed";
export type AppraisalStatus = "draft" | "submitted" | "completed";

export interface IPerformanceCycle extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  title: string;
  startDate: Date;
  endDate: Date;
  status: PerformanceCycleStatus;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAppraisalGoal {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  weight: number;
  selfRating?: number | null;
  managerRating?: number | null;
}

export interface IAppraisal extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  cycle: Types.ObjectId | IPerformanceCycle;
  employee: Types.ObjectId | IEmployee;
  user: Types.ObjectId | IUser;
  goals: IAppraisalGoal[];
  selfComment?: string;
  managerComment?: string;
  status: AppraisalStatus;
  overallRating?: number | null;
  submittedAt?: Date | null;
  completedAt?: Date | null;
  reviewedBy?: Types.ObjectId | IUser | null;
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
/** Where somebody works, which decides where they are allowed to punch. */
export type WorkMode = "office" | "wfh";

/** How closely a remote employee is held to their registered browser. */
export type RemoteDevicePolicy = "off" | "flag" | "enforce";

/** Why a punch was marked as coming from the wrong place. */
export type DeviceAnomaly = "unknown_device" | "no_device" | "changed_device";

/**
 * A remote employee's registered browser. The key itself is never stored —
 * only its hash — so this record cannot be used to punch as them.
 */
export interface ITrustedDevice {
  keyHash: string;
  label?: string;
  fingerprint?: string;
  boundAt?: Date;
  boundIp?: string;
  lastSeenAt?: Date | null;
}

/** Document categories collected during onboarding (location-driven). */
export type DocumentType =
  | "passport"
  | "visa_copy"
  | "emirates_id"
  | "labour_card"
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

/** A document or credential outside the fixed passport/visa/labour-card set. */
export interface IEmployeeOtherDocument {
  _id?: unknown;
  label: string;
  number?: string;
  issueDate?: Date | null;
  expiryDate?: Date | null;
  notes?: string;
  fileName?: string;
  fileKey?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: Date | null;
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
export interface ILabourCard {
  cardNumber?: string;
  issueDate?: Date | null;
  expiryDate?: Date | null;
}
export interface IEmiratesId {
  idNumber?: string;
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
  workMode: WorkMode;
  /** The single browser a remote employee may punch from. See the model. */
  trustedDevice?: ITrustedDevice | null;
  /** Monthly base salary (used to prefill payslips). */
  salary?: number;
  currency?: string;
  /** Profile/portal photo — R2 object key of the uploaded "photo" document. */
  photo?: string;
  /** Uploaded onboarding documents (passport, visa, certificates, …). */
  documents?: IEmployeeDocument[];
  /** Free-form documents and credentials the fixed fields don't cover. */
  otherDocuments?: IEmployeeOtherDocument[];

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
  labourCard?: ILabourCard;
  emiratesId?: IEmiratesId;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Attendance Regularization ──────────────────────────────────────────────
/** Attendance statuses a regularization may set. */
export type RegularizationOutcome = "present" | "half_day" | "wfh";

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
  /** Status the day takes on approval. */
  resultingStatus: RegularizationOutcome;
  requestedCheckIn?: Date | null;
  requestedCheckOut?: Date | null;
  reason?: string;
  status: RegularizationStatus;
  /** Where this sat in the person's month when they raised it. */
  monthlyIndex: number;
  /** Past the month's allowance, so the reporting manager has to sign it off. */
  escalated: boolean;
  escalatedTo?: Types.ObjectId | IUser | null;
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

/**
 * Where a month's payroll has got to between HR and the accounts department.
 *
 *  draft          — HR is still working. Payslips are editable.
 *  submitted      — HR has declared the month final and handed it to finance.
 *  in_finance     — finance has imported it and is adding or deducting.
 *  approved       — finance has signed the figures off, ready to pay.
 *  partially_paid — some people have been paid, some have not.
 *  paid           — everyone on the run has been paid.
 *  returned       — finance sent it back for HR to fix; editable again.
 *
 * Every status except draft and returned freezes the month's payslips. That is
 * the point of the record: once finance holds the figures, HR changing a number
 * underneath them means the money that leaves the bank and the payslip the
 * employee downloads describe two different months.
 */
export type PayrollBatchStatus =
  | "draft"
  | "submitted"
  | "in_finance"
  | "approved"
  | "partially_paid"
  | "paid"
  | "returned";

export interface IPayrollBatch extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  /** Pay period, "YYYY-MM". */
  month: string;
  monthDate: Date;
  currency: string;
  status: PayrollBatchStatus;
  /** Totals as they stood when HR submitted — what finance was handed. */
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  submittedBy?: Types.ObjectId | IUser | null;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  paidAt?: Date | null;
  returnedAt?: Date | null;
  returnReason?: string;
  /** The finance-side run this was imported into, once it has been. */
  financeRunId?: string;
  /** Payments accounts have reported, kept so a retry is not re-applied. */
  payments: Array<{
    paymentId: string;
    paidOn: Date;
    reference?: string;
    method?: string;
    payslipCount: number;
    amount: number;
    recordedAt: Date;
  }>;
  history: Array<{
    from: PayrollBatchStatus;
    to: PayrollBatchStatus;
    at: Date;
    by?: Types.ObjectId | IUser | null;
    actor: string;
    note?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
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
  /** What this slip collected against loans / one-time deductions. */
  recoveries?: Array<{ kind: "loan" | "adjustment"; ref: Types.ObjectId; amount: number }>;
  /** Scheduled recovery this month couldn't afford. */
  deferred?: number;
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
  /** A working day with no attendance and no leave counts as unpaid. */
  unrecordedDaysUnpaid: boolean;
  /** What a new regularization proposes before anyone changes it. */
  defaultRegularizationStatus: RegularizationOutcome;
  /** Corrections a person may raise in a month before their manager signs off. */
  monthlyRegularizationLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Leave Calendar: Leave Requests ─────────────────────────────────────────
/** Built-in leave slugs. A work schedule may define others of its own. */
export type BuiltinLeaveType =
  | "annual" | "sick" | "casual" | "unpaid" | "maternity" | "paternity" | "wfh" | "comp_off";
/** Any leave slug — built-in, or one a schedule defines. */
export type LeaveType = BuiltinLeaveType | (string & {});

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

// ─── Approval workflow (configurable multi-step approval chains) ────────────
/** Approvable modules that can have a configurable multi-step chain — the
 *  ones sharing the same pending → approved/rejected + reviewedBy shape. */
export type ApprovableModule = "leave" | "regularization" | "reimbursements" | "confirmations" | "hiring" | "agreements";

/**
 * When a step applies. `always` is every record; anything else names a
 * condition the record must meet, so one configured chain can cover both a
 * replacement that costs no more than the person leaving and one that does.
 */
export type ApprovalStepCondition = "always" | "budget_increase";

export interface IApprovalStep {
  order: number;
  when?: ApprovalStepCondition;
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

// ─── Leave policy (what a kind of leave grants) ───────────────────────────────
export type LeavePeriod = "month" | "year";

export interface ILeavePolicy extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  /** Open slug — an organization can name leave the built-in set doesn't cover. */
  type: string;
  /** Display name for a type the built-in list doesn't cover. */
  label?: string;
  /** The work schedule this covers; null applies to the whole organization. */
  workSchedule?: Types.ObjectId | { _id: Types.ObjectId; name?: string } | null;
  /** How many days `period` grants. */
  days: number;
  period: LeavePeriod;
  /** Unpaid leave becomes Loss of Pay on the payslip; paid leave does not. */
  paid: boolean;
  /** Months of service before this leave can be taken. 0 = from day one. */
  eligibleAfterMonths: number;
  /** Yearly only: max unused days carried into the next year (0 = none). */
  carryForwardLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Computed — not persisted. One employee's balance for one leave type/period. */
export interface ILeaveBalance {
  type: string;
  label: string;
  year: number;
  period: LeavePeriod;
  paid: boolean;
  /** Days the policy grants per its own period. */
  days: number;
  /** What this period grants them — the full days once eligible, else 0. */
  accrued: number;
  carriedForward: number;
  /** Corrections the rules cannot derive — an opening balance, a manual credit. */
  adjustment: number;
  used: number;
  balance: number;
  /** Months of service the policy asks for before this leave opens up. */
  eligibleAfterMonths: number;
  /** Whether they have served that long yet. */
  eligible: boolean;
  /** The date they become eligible, or null if already or unknown. */
  eligibleOn: string | null;
  /** True when there is no joining date to measure service from. */
  joiningDateMissing: boolean;
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
/**
 * What kind of thing an asset is. An open list: these are the values the app
 * offers, and anything else somebody types is equally valid. See the model.
 */
export const ASSET_CATEGORIES = [
  "laptop", "monitor", "phone", "telephone", "tablet", "mouse", "keyboard",
  "headphone", "camera", "printer", "charger", "mini_pc", "pos_machine",
  "accounts_equipment", "furniture", "uniform", "sim_card", "vehicle", "other",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number] | (string & {});
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
  /** Which office holds it, and where inside it. */
  branch?: string;
  location?: string;
  /** How many this record stands for; 1 for anything individually tagged. */
  quantity?: number;
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
  // ── Exit clearance & interview ──
  clearance?: IClearanceItem[];
  exitInterview?: IExitInterview | null;
  reviewedBy?: Types.ObjectId | IUser | null;
  reviewedAt?: Date | null;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Probation confirmation ─────────────────────────────────────────────────
export type ConfirmationStatus = "pending" | "confirmed" | "rejected";

export interface IConfirmation extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  employee: Types.ObjectId | IEmployee;
  /** Probation end derived at creation: joining date + probation days. */
  dueDate?: Date | null;
  confirmationDate: Date;
  status: ConfirmationStatus;
  notes?: string;
  initiatedBy?: Types.ObjectId | IUser | null;
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

export type ClearanceDepartment = "it" | "finance" | "hr" | "admin" | "manager";
export type ClearanceStatus = "pending" | "cleared" | "not_applicable";

export interface IClearanceItem {
  _id?: Types.ObjectId;
  department: ClearanceDepartment;
  item: string;
  status: ClearanceStatus;
  notes?: string;
  clearedBy?: Types.ObjectId | IUser | null;
  clearedAt?: Date | null;
}

export type ExitReason =
  | "compensation" | "career_growth" | "work_life_balance" | "management"
  | "relocation" | "higher_studies" | "health" | "role_mismatch" | "other";

export interface IExitInterview {
  conductedBy?: Types.ObjectId | IUser | null;
  conductedAt?: Date | null;
  primaryReason?: ExitReason;
  ratings?: {
    workEnvironment?: number | null;
    management?: number | null;
    growth?: number | null;
    compensation?: number | null;
    workLifeBalance?: number | null;
  };
  whatWentWell?: string;
  whatCouldImprove?: string;
  wouldRecommend?: boolean | null;
  eligibleForRehire?: boolean | null;
  notes?: string;
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
  /** Recovered so far — a deduction may span several payslips. */
  appliedAmount: number;
  applied: boolean;
  payslip?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | IUser | null;
  /** Who raised it: HR, or the accounts department during their pass. */
  source?: "hr" | "finance";
  /** The accounts-side id, so a retried request updates rather than duplicates. */
  externalId?: string | null;
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

/** A record of a sensitive/privileged action — currently just impersonation
 *  start/end, kept minimal and append-only (no update/delete API). */
export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  action: string;
  actor: Types.ObjectId | IUser;
  actorName: string;
  target?: Types.ObjectId | IUser | null;
  targetName?: string | null;
  createdAt: Date;
}

export interface IConsumedTicket extends Document {
  _id: Types.ObjectId;
  jti: string;
  expiresAt: Date;
  createdAt: Date;
}

// ─── Hiring ──────────────────────────────────────────────────────────────────
/**
 * Why a role is being filled. A replacement backfills somebody who has left or
 * is leaving; new headcount is a position that did not exist. The distinction
 * decides who has to approve it — see requiresBudgetApproval().
 */
export type RequisitionType = "replacement" | "new_headcount";

export type RequisitionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "on_hold"
  | "filled"
  | "cancelled";

export interface IJobRequisition extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  type: RequisitionType;
  /** Who is being backfilled. Required for a replacement, null otherwise. */
  replacing?: Types.ObjectId | IEmployee | null;
  title: string;
  department?: Types.ObjectId | IDepartment | null;
  designation?: string;
  location?: EmployeeLocation;
  employmentType?: EmploymentType;
  headcount: number;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  /** What the person being replaced was paid, frozen when the request is
   *  raised — the comparison that decides whether Finance sees this at all. */
  replacingSalary?: number | null;
  /** Whether the budget step applied, stored so the trail explains itself
   *  later even if salaries change afterwards. */
  budgetApprovalRequired: boolean;
  justification?: string;
  targetStartDate?: Date | null;
  raisedBy: Types.ObjectId | IUser;
  status: RequisitionStatus;
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: IApprovalStepSnapshot[];
  approvalTrail?: IApprovalTrailEntry[];
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Where an application has reached.
 *
 * Ordered: the index is the pipeline position, so a move is a comparison rather
 * than a table of allowed transitions. `rejected` and `withdrawn` sit outside
 * it — they can happen from anywhere and lead nowhere.
 */
export const APPLICATION_STAGES = [
  "applied",
  "screening",
  "shortlisted",
  "interview",
  "offer",
  "accepted",
  "hired",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
/**
 * `waitlisted` is a parking space, not an ending: a good candidate with no
 * vacancy right now. Kept distinct from rejected so it can be pulled back, and
 * so a pipeline does not have to pretend they were turned down.
 */
export type ApplicationStatus = "active" | "waitlisted" | "rejected" | "withdrawn";

/** Whether an offer has been released. Management sign off before it goes out. */
export type OfferApprovalStatus = "not_requested" | "pending" | "approved" | "rejected";

export interface ICandidate extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  name: string;
  email: string;
  phone?: string;
  /** Where they came from — referral, agency, a job board, walk-in. */
  source?: string;
  currentCompany?: string;
  currentDesignation?: string;
  totalExperienceYears?: number;
  noticePeriodDays?: number;
  expectedSalary?: number;
  currency?: string;
  location?: string;
  resumeKey?: string;
  resumeFileName?: string;
  links?: string[];
  notes?: string;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IApplication extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  requisition: Types.ObjectId | IJobRequisition;
  candidate: Types.ObjectId | ICandidate;
  stage: ApplicationStage;
  status: ApplicationStatus;
  rating?: number | null;
  offeredSalary?: number | null;
  rejectionReason?: string;
  /** Set once the offer is accepted and they become an employee. */
  movedToEmployee?: Types.ObjectId | IEmployee | null;
  /**
   * Management's sign-off on releasing an offer. Reaching the offer stage asks
   * for it; accepting cannot happen until it is given.
   */
  offerApproval?: {
    status: OfferApprovalStatus;
    requestedBy?: Types.ObjectId | IUser | null;
    requestedAt?: Date | null;
    decidedBy?: Types.ObjectId | IUser | null;
    decidedAt?: Date | null;
    note?: string;
  };
  /** Every stage this application has been through, and who moved it. */
  stageHistory?: Array<{
    stage: ApplicationStage | ApplicationStatus;
    by?: Types.ObjectId | IUser | null;
    at: Date;
    note?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export type InterviewMode = "in_person" | "video" | "phone";
export type InterviewStatus = "scheduled" | "completed" | "no_show" | "cancelled";
/** Strong signals kept distinct from soft ones — an averaged "3/5" hides both. */
export type Recommendation = "strong_yes" | "yes" | "no" | "strong_no";

export interface IInterview extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  application: Types.ObjectId | IApplication;
  /** 1 for the first conversation, 2 for the next, and so on. */
  round: number;
  title?: string;
  mode: InterviewMode;
  scheduledAt: Date;
  durationMinutes: number;
  timeZone: string;
  location?: string;
  meetingLink?: string;
  /** A link to a recording held elsewhere. Nothing is stored here. */
  recordingLink?: string;
  panel: Array<Types.ObjectId | IUser>;
  status: InterviewStatus;
  notes?: string;
  /** Bumped on every re-send so calendars treat it as an update, not a copy. */
  inviteSequence: number;
  createdBy?: Types.ObjectId | IUser | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInterviewFeedback extends Document {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | IOrganization | null;
  interview: Types.ObjectId | IInterview;
  panellist: Types.ObjectId | IUser;
  recommendation: Recommendation;
  scores?: Array<{ skill: string; rating: number }>;
  notes?: string;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
