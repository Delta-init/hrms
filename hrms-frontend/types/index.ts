// ─── Permissions ──────────────────────────────────────────────────────────────
/**
 * Order is load-bearing: it fixes the bit position of each action when the
 * permission map is packed into the session JWT (see lib/auth/authOptions.ts).
 * Appending is safe; reordering or removing would silently reinterpret the
 * permissions of every already-issued session.
 */
export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

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
  // The check-in tablet by the door — its own module so a device account can be
  // granted the kiosk and nothing else.
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

export const MODULE_LABELS: Record<HrmsModule, string> = {
  dashboard: "Dashboard",
  employees: "Employees",
  departments: "Departments",
  attendance: "Attendance",
  kiosk: "Check-in Kiosk",
  leave: "Leave",
  payroll: "Payroll",
  regularization: "Regularization",
  workSchedules: "Work Schedules",
  cards: "Cards",
  resignations: "Resignations",
  loans: "Loans",
  salaryIncrements: "Salary Increments",
  reimbursements: "Reimbursements",
  assets: "Assets",
  onboardingTasks: "Onboarding Tasks",
  hiring: "Hiring",
  confirmations: "Confirmations",
  letters: "Letters",
  announcements: "Announcements",
  surveys: "Surveys",
  approvalWorkflows: "Approval Workflows",
  helpdesk: "Helpdesk",
  reports: "Reports",
  performance: "Performance",
  organizations: "Organizations",
  users: "Users",
  roles: "Roles & Permissions",
  settings: "Settings",
};

// ─── Organization (multi-tenancy) ─────────────────────────────────────────────
export interface OrganizationSettings {
  currency?: string;
  timeZone?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  mailFrom?: string;
  /** Hold office staff to punching at a kiosk rather than their dashboard. */
  enforceWorkMode?: boolean;
  /** Onboarding also requires a face on file. Ignored if the service is down. */
  requireFaceEnrollment?: boolean;
  /** How closely remote staff are held to their registered browser. */
  remoteDevice?: RemoteDevicePolicy;
  /** Hold new joiners at the induction and agreements. */
  requireAgreements?: boolean;
  /** Refuse a work-from-home punch that carries no location fix. */
  requireRemoteLocation?: boolean;
}
export interface Organization {
  _id: string;
  name: string;
  code: string;
  logo?: string;
  status: "active" | "inactive";
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
}
/** `settings` is partial here: sign-in populates only currency and timeZone. */
export type OrganizationSimple = Pick<Organization, "_id" | "name" | "code" | "logo"> & {
  settings?: Partial<OrganizationSettings>;
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

/** A dated assignment of a work schedule (shift) to an employee — the
 *  building block for shift rotation; attendance resolves the assignment
 *  in force for a given date instead of one static schedule per employee. */
export interface RosterAssignment {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string } | string | null;
  workSchedule?: WorkScheduleSimple | string | null;
  effectiveFrom: string;
  /** Null/absent = open-ended (still in force). */
  effectiveTo?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Per-org rule converting repeated lateness into a payroll deduction: the
 *  first `graceLates` late arrivals in a month are free, then every further
 *  `lateBlockSize` late arrivals count as one half-day Loss-of-Pay. */
export interface AttendancePenaltyPolicy {
  enabled: boolean;
  graceLates: number;
  lateBlockSize: number;
  unrecordedDaysUnpaid: boolean;
  /** What a new regularization proposes before anyone changes it. */
  defaultRegularizationStatus: RegularizationOutcome;
}

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
export type EmployeeStatus = "active" | "probation" | "on_leave" | "notice_period" | "terminated";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
};

/** How somebody left. Mirrors `resignationType` on the resignation record. */
export type ExitType = "resignation" | "termination" | "retirement" | "end_of_contract" | "absconding";
export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  resignation: "Resigned",
  termination: "Terminated",
  retirement: "Retired",
  end_of_contract: "Contract ended",
  absconding: "Absconded",
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  probation: "Probation",
  on_leave: "On Leave",
  notice_period: "Notice Period",
  terminated: "Terminated",
};

export type Title = "mr" | "mrs" | "ms" | "dr";
export type Gender = "male" | "female" | "other";
export type MaritalStatus = "married" | "unmarried";
export type EmployeeLocation = "india" | "dubai";
export const LOCATION_LABELS: Record<EmployeeLocation, string> = { india: "India", dubai: "Dubai" };

/** Where somebody works, which decides where they are allowed to punch. */
export type WorkMode = "office" | "wfh";
export const WORK_MODE_LABELS: Record<WorkMode, string> = { office: "Office", wfh: "Work from home" };

/** How closely remote staff are held to their registered browser. */
export type RemoteDevicePolicy = "off" | "flag" | "enforce";
export const REMOTE_DEVICE_LABELS: Record<RemoteDevicePolicy, string> = {
  off: "Not tracked",
  flag: "Flag anomalies",
  enforce: "Block other devices",
};

/** Why a punch was marked as coming from somewhere other than the registered device. */
export type DeviceAnomaly = "unknown_device" | "no_device" | "changed_device";
export const DEVICE_ANOMALY_LABELS: Record<DeviceAnomaly, string> = {
  unknown_device: "Punched from a device that isn't their registered one",
  no_device: "Punched from a browser that couldn't identify itself",
  changed_device: "Same device key, but the machine looked different",
};

// ─── Employee documents (location-driven onboarding) ─────────────────────────
export type DocumentType =
  | "passport"
  | "visa_copy"
  | "emirates_id"
  | "labour_card"
  | "aadhaar"
  | "photo"
  | "education_certificate"
  | "experience_certificate";

export interface DocRequirement {
  key: string;
  label: string;
  required: boolean;
  isPhoto?: boolean;
  accepts: DocumentType[];
}
export interface EmployeeDocument {
  type: DocumentType;
  fileName?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
  url: string;
}
/** A document or credential outside the fixed passport/visa/labour-card set. */
export interface EmployeeOtherDocument {
  _id: string;
  label: string;
  number?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  notes?: string;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string | null;
}

/** What a person may request, and how much of it is left this month. */
export interface LeaveOptions {
  scheduleName: string | null;
  /** True when no schedule policy applies — every type stays available. */
  /** Retained for compatibility; always false — nothing is offered without a policy. */
  unrestricted: boolean;
  options: Array<{ type: string; label: string; days: number; period: LeavePeriod; paid: boolean; used: number; remaining: number; eligible: boolean; eligibleOn: string | null; eligibleAfterMonths: number }>;
}

export interface DocumentsResponse {
  location: EmployeeLocation | null;
  requirements: DocRequirement[];
  documents: EmployeeDocument[];
  photo: string;
}

export const TITLE_LABELS: Record<Title, string> = { mr: "Mr", mrs: "Mrs", ms: "Ms", dr: "Dr" };
export const GENDER_LABELS: Record<Gender, string> = { male: "Male", female: "Female", other: "Other" };
export const MARITAL_LABELS: Record<MaritalStatus, string> = { married: "Married", unmarried: "Unmarried" };
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export interface Education {
  qualification?: string;
  from?: string;
  to?: string;
  institute?: string;
}
export interface Address {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}
export interface EmergencyContact {
  name?: string;
  relation?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  phoneNumber?: string;
  email?: string;
}
export interface BankDetails {
  bankAccountNumber?: string;
  ibanIfsc?: string;
  bankName?: string;
  nameInBank?: string;
}
export interface FamilyMember {
  name?: string;
  relation?: string;
  dob?: string | null;
  phone?: string;
}
export interface Passport {
  passportNumber?: string;
  country?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
}
export interface Visa {
  country?: string;
  type?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
}
export interface LabourCard {
  cardNumber?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
}
export interface EmiratesId {
  idNumber?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
}
export const VISA_TYPES = [
  "Employment", "Residence", "Visit", "Tourist", "Business", "Student", "Dependent", "Transit", "Golden", "Other",
] as const;
export type EmployeeRef = { _id: string; name: string; employeeCode?: string; designation?: string };

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
  /** Present only on leavers — how and when they went. */
  exitType?: ExitType | null;
  lastWorkingDay?: string | null;
  location?: EmployeeLocation;
  /** Absent on records written before the field existed; those are office. */
  workMode?: WorkMode;
  /** The one browser this person may punch from, when binding is on. */
  trustedDevice?: {
    label?: string;
    boundAt?: string;
    boundIp?: string;
    lastSeenAt?: string | null;
  } | null;
  salary?: number;
  currency?: string;
  photo?: string;
  /** Servable URL for `photo`; empty when none is set. */
  photoUrl?: string;
  otherDocuments?: EmployeeOtherDocument[];
  documents?: EmployeeDocument[];

  // Personal
  title?: Title;
  gender?: Gender;
  personalEmail?: string;
  mobileNumber?: string;
  dob?: string | null;
  bloodGroup?: string;
  nationality?: string;
  maritalStatus?: MaritalStatus;

  // Employment
  oldCompanyExperience?: string;
  confirmationDate?: string | null;
  probationPeriodDays?: number;
  noticePeriodDays?: number;
  reportingTo?: EmployeeRef | { _id: string; name: string; email?: string } | string | null;
  reportingToKind?: "Employee" | "User";

  // Bank / education / addresses / emergency
  bank?: BankDetails;
  education?: Education[];
  currentAddress?: Address;
  permanentAddress?: Address;
  emergencyContacts?: EmergencyContact[];
  familyMembers?: FamilyMember[];
  passport?: Passport;
  visa?: Visa;
  labourCard?: LabourCard;
  emiratesId?: EmiratesId;

  createdAt: string;
  updatedAt: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: Role;
  organization?: OrganizationSimple | string | null;
  designation?: string;
  status: "active" | "inactive" | "invited";
  profileCompleted?: boolean;
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
  /**
   * Set when a punch that day came from somewhere other than the registered
   * device. Flattened from the punch sources by the server, the same way the
   * day view gets it, so both tabs flag the same day.
   */
  deviceAnomaly?: DeviceAnomaly | null;
  /** The machine that punch came from — named only when it was flagged. */
  deviceLabel?: string | null;
  /** Where and from what the day was started, taken from the check-in punch. */
  punchDevice?: string | null;
  punchIp?: string | null;
  /** "Dubai, DU, AE" — as much of it as the IP lookup could give. */
  punchPlace?: string | null;
  /** The GPS fix as a street address: road, area, city, district, state, country. */
  punchAddress?: string | null;
  /** The same address as the geocoder phrases it, for the tooltip. */
  punchAddressFull?: string | null;
  /** The way out, so the two ends of a day can be read against each other. */
  punchOutDevice?: string | null;
  punchOutIp?: string | null;
  punchOutAddress?: string | null;
  punchOutAddressFull?: string | null;
  punchOutCoords?: { latitude: number; longitude: number } | null;
  /** "device" | "ip" | "location" — empty when clocking in and out agree. */
  punchDiffers?: string[];
  /** Distance between the two fixes, where both ends had one. */
  punchMovedMetres?: number | null;
  punchCoords?: { latitude: number; longitude: number } | null;
  /** Why there is no fix, when there is none: denied, unavailable, unsupported. */
  punchLocationSource?: "gps" | "denied" | "unavailable" | "unsupported" | null;
  punchMethod?: "web" | "face" | "manual" | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Leave ──────────────────────────────────────────────────────────────────
/** Built-in leave slugs. A work schedule may define others of its own. */
export type BuiltinLeaveType =
  | "annual" | "sick" | "casual" | "unpaid" | "maternity" | "paternity" | "wfh" | "comp_off";
/** Any leave slug — built-in, or one a schedule defines. */
export type LeaveType = BuiltinLeaveType | (string & {});
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export const LEAVE_TYPE_LABELS: Record<BuiltinLeaveType, string> = {
  annual: "Annual",
  sick: "Sick",
  casual: "Casual",
  unpaid: "Unpaid",
  maternity: "Maternity",
  paternity: "Paternity",
  wfh: "Work From Home",
  comp_off: "Comp-Off",
};

/** Every built-in slug, for pickers that offer the standard set. */
export const BUILTIN_LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABELS) as BuiltinLeaveType[];

/** Display name for a slug — the schedule's own label wins over the built-in. */
export function leaveTypeLabel(type: LeaveType, label?: string): string {
  return label?.trim() || LEAVE_TYPE_LABELS[type as BuiltinLeaveType] || type;
}

// ─── Approval workflow (configurable multi-step approval chains) ────────────
export type ApprovableModule = "leave" | "regularization" | "reimbursements" | "confirmations";

export interface ApprovalWorkflowStep {
  order: number;
  role: { _id: string; roleName: string } | string;
  label?: string;
}
export interface ApprovalWorkflow {
  _id: string;
  module: ApprovableModule;
  enabled: boolean;
  steps: ApprovalWorkflowStep[];
  createdAt: string;
  updatedAt: string;
}
/** Snapshotted onto a record at creation — later workflow edits don't retroactively change it. */
export interface ApprovalStepSnapshot {
  order: number;
  role: string;
  roleName: string;
  label?: string;
}
export interface ApprovalTrailEntry {
  step: number;
  roleName?: string;
  by: { _id: string; name: string } | string;
  action: "approved" | "rejected";
  note?: string;
  at: string;
}
/** Shared workflow-state fields mixed into every approvable record. */
export interface WorkflowState {
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: ApprovalStepSnapshot[];
  approvalTrail?: ApprovalTrailEntry[];
}

export interface LeaveRequest extends WorkflowState {
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

// ─── Leave policy (balances & accrual) ─────────────────────────────────────────
// comp_off is earned per off-day-worked event, not an annual accrual — it never
// gets a LeavePolicy row, so policy/balance types exclude it deliberately.
/**
 * Types the org-level annual policy covers.
 *
 * Deliberately the built-in set: an annual entitlement is a company-wide
 * arrangement, whereas custom types are defined by, and belong to, a single
 * work schedule.
 */
export type PolicyLeaveType = Exclude<BuiltinLeaveType, "comp_off">;

export type LeavePeriod = "month" | "year";
export const LEAVE_PERIOD_LABELS: Record<LeavePeriod, string> = { month: "Every month", year: "Every year" };

export interface LeavePolicy {
  _id: string;
  /** Open slug — organizations can name leave the built-in set doesn't cover. */
  type: string;
  /** Display name for a type the built-in list doesn't cover. */
  label?: string;
  /** The work schedule this covers; null applies to everyone in the org. */
  workSchedule?: { _id: string; name: string } | string | null;
  /** How many days `period` grants. */
  days: number;
  period: LeavePeriod;
  /** Unpaid leave becomes Loss of Pay on the payslip. */
  paid: boolean;
  /** Months of service before this leave can be taken. 0 = from day one. */
  eligibleAfterMonths: number;
  carryForwardLimit: number;
  createdAt: string;
  updatedAt: string;
}
export interface LeaveBalance {
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
  used: number;
  balance: number;
  eligibleAfterMonths: number;
  eligible: boolean;
  /** The date they qualify, or null if already or unknown. */
  eligibleOn: string | null;
  /** True when there is no joining date to measure service from. */
  joiningDateMissing: boolean;
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
/** Attendance statuses a regularization can set on approval. */
export type RegularizationOutcome = "present" | "half_day" | "wfh";
export const REGULARIZATION_OUTCOMES: RegularizationOutcome[] = ["present", "half_day", "wfh"];

export type RegularizationType = "missing_checkin" | "missing_checkout" | "wrong_time" | "absent_correction";
export type RegularizationStatus = "pending" | "approved" | "rejected" | "cancelled";

export const REGULARIZATION_TYPE_LABELS: Record<RegularizationType, string> = {
  missing_checkin: "Missing Check-in",
  missing_checkout: "Missing Check-out",
  wrong_time: "Wrong Time",
  absent_correction: "Absent Correction",
};

export interface Regularization extends WorkflowState {
  _id: string;
  user: { _id: string; name: string; email?: string; designation?: string } | string;
  date: string;
  timeZone: string;
  type: RegularizationType;
  /** Status the day takes when this is approved. */
  resultingStatus?: RegularizationOutcome;
  requestedCheckIn?: string | null;
  requestedCheckOut?: string | null;
  reason?: string;
  status: RegularizationStatus;
  /** Where this sat in the requester's month — 4 means their fourth. */
  monthlyIndex?: number;
  /** Past the month's allowance, so the reporting manager has to sign it off. */
  escalated?: boolean;
  escalatedTo?: { _id: string; name: string } | string | null;
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

/**
 * What the browser volunteers when someone punches from the web app. The
 * server records the IP, country and device itself — those are not ours to
 * send, and would be worthless if they were.
 */
export interface PunchClientContext {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  locationSource?: "gps" | "denied" | "unavailable" | "unsupported";
  timeZone?: string;
  /** Identifies this browser when attendance is tied to one device. */
  deviceKey?: string;
  deviceLabel?: string;
  deviceFingerprint?: string;
}

export interface AttendanceToday {
  attendance: Attendance | null;
  schedule: { timeZone: string; loginTime: string; logoutTime: string; graceMinutes: number };
  shift: ShiftInfo;
  punchPolicy: {
    /** null when no employee record stands behind the login, so no policy applies. */
    workMode: WorkMode | null;
    /** False for office staff once the organization enforces kiosk check-in. */
    canSelfPunch: boolean;
    /** They may still close a session they opened here before it was enforced. */
    canFinishOpenSession: boolean;
    device: {
      /** How closely this person is held to their registered browser. */
      policy: RemoteDevicePolicy;
      /** A browser is already registered; a different one will be refused. */
      registered: boolean;
      label: string | null;
    };
    /** A work-from-home punch will be refused without a location fix. */
    locationRequired?: boolean;
  };
}

// ─── Payslip ─────────────────────────────────────────────────────────────────
export type PayslipStatus = "draft" | "issued" | "paid";

/**
 * Statuses HR may set by hand.
 *
 * "paid" is missing on purpose: it asserts that money left a bank account,
 * which happens in the accounts system and arrives here over the payroll
 * integration. The API refuses it too — this is the screen agreeing.
 */
export const HR_SETTABLE_PAYSLIP_STATUSES = ["draft", "issued"] as const;
export type HrSettablePayslipStatus = (typeof HR_SETTABLE_PAYSLIP_STATUSES)[number];

export type PayrollBatchStatus =
  | "draft" | "submitted" | "in_finance" | "approved" | "partially_paid" | "paid" | "returned";

export const PAYROLL_BATCH_LABELS: Record<PayrollBatchStatus, string> = {
  draft: "Not submitted",
  submitted: "With accounts",
  in_finance: "Accounts reviewing",
  approved: "Approved for payment",
  partially_paid: "Partly paid",
  paid: "Paid",
  returned: "Sent back by accounts",
};

export interface PayrollBatch {
  month: string;
  status: PayrollBatchStatus;
  exists: boolean;
  editable: boolean;
  currency: string;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  returnedAt: string | null;
  returnReason: string;
  financeRunId: string;
  history: Array<{ from: string; to: string; at: string; actor: string; note?: string }>;
}

export interface PayrollPreflight {
  month: string;
  status: PayrollBatchStatus;
  canSubmit: boolean;
  /** Refusals. Submit is blocked while any remain. */
  blockers: string[];
  /** Things worth knowing that do not stop the handover. */
  warnings: string[];
  totals: { employeeCount: number; grossTotal: number; deductionTotal: number; netTotal: number };
}
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
  unpaidLeaveDays: number; lopDays: number; latePenaltyDays: number; salary: number; currency: string;
  /** Approved leave and holidays falling on working days — both paid. */
  paidLeaveDays?: number;
  holidayDays?: number;
  /**
   * Lines the payslip adds by itself — reimbursements, overtime, one-time
   * items. Shown so the form previews the payslip it will actually create;
   * never submitted back, since the server re-derives them.
   */
  autoEarnings?: PayComponentLine[];
  autoDeductions?: PayComponentLine[];
  /** The salary breakup in force — Basic plus any structure components. */
  earnings?: PayComponentLine[];
  structureDeductions?: PayComponentLine[];
  structureName?: string | null;
  /** Scheduled working days in the month, and those left after unpaid days. */
  workingDays?: number;
  paidDays?: number;
  /** Working days with attendance, leave or a holiday — and those with none. */
  recordedDays?: number;
  unrecordedDays?: number;
  /** How many of the unrecorded days are still to come this month. */
  unrecordedFutureDays?: number;
  /** Whether the organization charges those days as loss of pay. */
  unrecordedDaysUnpaid?: boolean;
  /** Contractual gross cut to the part of the month they were employed. */
  proratedGross?: number;
  /** 1 unless they joined or left mid-month, when it is their share of it. */
  employedShare?: number;
  /** First and last day on the payroll, when either falls inside the month. */
  employment?: { from: string | null; to: string | null };
  /** Days of salary this month is worth for them — 30, or their share of it. */
  salaryDays?: number;
}

// ─── Monthly payroll run ─────────────────────────────────────────────────────
export interface PayComponentLine {
  label: string;
  amount: number;
}
export interface PayrollRunRow {
  employee: { _id: string; name: string; employeeCode?: string };
  currency: string;
  /** Gross of all earnings (Basic + allowances). */
  salary: number;
  /** Earning lines from the salary structure (Basic first), else a single Basic. */
  earnings: PayComponentLine[];
  /** Name of the salary structure in force, or null when on plain salary. */
  structureName: string | null;
  /** Recurring deduction lines from the salary structure. */
  structureDeductions: PayComponentLine[];
  lopDays: number;
  /** Scheduled working days in the month — what lopDays is out of. */
  workingDays?: number;
  lopAmount: number;
  /** What one lost day costs (salary ÷ 30), as the server priced it. */
  lopPerDay?: number;
  latePenaltyDays: number;
  latePenaltyAmount: number;
  loanTotal: number;
  oneTimePayments: number;
  oneTimeDeductions: number;
  /** Approved expense reimbursements paid out this month (earnings). */
  reimbursements: number;
  /** Overtime paid out this month (earnings). */
  overtime: number;
  totalDeductions: number;
  netPay: number;
  /** id of the existing payslip for this month, or null if not generated. */
  payslipId: string | null;
  /** null → no payslip generated for this month yet. */
  status: PayslipStatus | null;
}
export interface PayrollRun {
  month: string;
  rows: PayrollRunRow[];
}

export interface SalaryRegisterRow {
  employee: { _id: string; name: string; employeeCode?: string; designation?: string };
  currency: string;
  bank: { iban: string; accountNumber: string; bankName: string; nameInBank: string };
  earnings: PayComponentLine[];
  deductions: PayComponentLine[];
  structureName: string | null;
  gross: number;
  totalDeductions: number;
  net: number;
}
export interface SalaryRegister {
  month: string;
  currency: string;
  rows: SalaryRegisterRow[];
  totals: { gross: number; deductions: number; net: number; count: number };
}

export interface PayrollChecklistItem {
  _id: string;
  label: string;
  link?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// ─── One-time payment / deduction ─────────────────────────────────────────────
export type OneTimeKind = "payment" | "deduction";
export const ONE_TIME_KIND_LABELS: Record<OneTimeKind, string> = { payment: "Payment", deduction: "Deduction" };
export interface OneTimeAdjustment {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; currency?: string } | string | null;
  kind: OneTimeKind;
  label: string;
  amount: number;
  month: string;
  notes?: string;
  applied: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Reimbursement claim ──────────────────────────────────────────────────────
export type ReimbursementCategory =
  | "travel" | "food" | "accommodation" | "medical" | "communication" | "fuel" | "supplies" | "other";
export type ReimbursementStatus = "pending" | "approved" | "rejected" | "paid";
export const REIMBURSEMENT_CATEGORY_LABELS: Record<ReimbursementCategory, string> = {
  travel: "Travel", food: "Food", accommodation: "Accommodation", medical: "Medical",
  communication: "Communication", fuel: "Fuel", supplies: "Supplies", other: "Other",
};
export const REIMBURSEMENT_STATUS_LABELS: Record<ReimbursementStatus, string> = {
  pending: "Pending", approved: "Approved", rejected: "Rejected", paid: "Paid",
};
export interface Reimbursement extends WorkflowState {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; currency?: string } | string | null;
  user?: string | null;
  category: ReimbursementCategory;
  title: string;
  amount: number;
  expenseDate: string;
  month: string;
  description?: string;
  receiptUrl?: string;
  status: ReimbursementStatus;
  reviewedBy?: { _id: string; name: string } | string | null;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Overtime ─────────────────────────────────────────────────────────────────
export interface Overtime {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; currency?: string } | string | null;
  date: string;
  hours: number;
  hourlyRate: number;
  multiplier: number;
  amount: number;
  month: string;
  notes?: string;
  applied: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Asset ────────────────────────────────────────────────────────────────────
/**
 * Open, not a union of seven.
 *
 * The register holds twenty-odd kinds of thing and grows whenever the business
 * buys something new, so the labels below are what we know how to write nicely
 * rather than what is allowed. Anything else falls back to a readable version
 * of its own slug — see `assetCategoryLabel`.
 */
export type AssetCategory = string;
export type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";
export type AssetStatus = "available" | "assigned" | "maintenance" | "retired";
export const ASSET_CATEGORY_LABELS: Record<string, string> = {
  laptop: "Laptop", phone: "Phone", monitor: "Monitor", furniture: "Furniture",
  vehicle: "Vehicle", sim_card: "SIM Card", mouse: "Mouse", keyboard: "Keyboard",
  headphone: "Headphone", tablet: "Tablet", telephone: "Telephone", camera: "Camera",
  clock: "Clock", speaker: "Speaker", printer: "Printer", charger: "Charger",
  mini_pc: "Mini PC", pos_machine: "POS Machine", uniform: "Uniform",
  accounts_equipment: "Accounts Equipment", first_aid: "First Aid", other: "Other",
};
/** The label we know, or the slug made readable: "pos_machine" → "Pos Machine". */
export const assetCategoryLabel = (c?: string | null): string =>
  (c && ASSET_CATEGORY_LABELS[c]) ||
  (c ? c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—");
export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  new: "New", good: "Good", fair: "Fair", poor: "Poor", damaged: "Damaged",
};
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: "Available", assigned: "Assigned", maintenance: "Maintenance", retired: "Retired",
};
export interface AssetHistoryEntry {
  action: "issued" | "returned" | "sent_to_maintenance" | "retired";
  employee?: { _id: string; name: string; employeeCode?: string } | string | null;
  date: string;
  condition?: AssetCondition;
  notes?: string;
}
export interface Asset {
  _id: string;
  name: string;
  category: AssetCategory;
  assetTag: string;
  serialNumber?: string;
  purchaseDate?: string | null;
  purchaseCost?: number;
  condition: AssetCondition;
  status: AssetStatus;
  assignedTo?: { _id: string; name: string; employeeCode?: string; designation?: string } | string | null;
  assignedDate?: string | null;
  /** Office or site the thing lives at, as the register spells it. */
  branch?: string;
  /** Room or desk within the branch. */
  location?: string;
  /** How many items this record stands for — bulk stock is counted, not tagged. */
  quantity?: number;
  notes?: string;
  history: AssetHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ─── Salary structure ────────────────────────────────────────────────────────
export type SalaryComponentType = "earning" | "deduction";
export type SalaryComponentCalc = "fixed" | "percent";
export const SALARY_COMPONENT_TYPE_LABELS: Record<SalaryComponentType, string> = { earning: "Earning", deduction: "Deduction" };
export const SALARY_COMPONENT_CALC_LABELS: Record<SalaryComponentCalc, string> = { fixed: "Fixed", percent: "% of Basic" };
export interface SalaryComponent {
  name: string;
  type: SalaryComponentType;
  calc: SalaryComponentCalc;
  value: number;
}
export interface SalaryStructure {
  _id: string;
  name: string;
  description?: string;
  components: SalaryComponent[];
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}
export interface SalaryStructureAssignment {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; currency?: string } | string | null;
  structure?: { _id: string; name: string; components?: SalaryComponent[] } | string | null;
  basicAmount: number;
  effectiveMonth: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
export interface SalaryBreakup {
  earnings: PayComponentLine[];
  deductions: PayComponentLine[];
  gross: number;
  structureName: string | null;
}

// ─── Attendance calendar ─────────────────────────────────────────────────────
export interface AttendanceCalendarDay {
  /** The attendance record behind this day, when one was recorded. */
  attendanceId?: string;
  status: AttendanceStatus;
  workedMinutes?: number;
  checkIn?: string | null;
  checkOut?: string | null;
  lateMinutes?: number;
  note?: string;
  timeZone?: string | null;
  /** Approved leave covering this day, shown even when attendance was recorded. */
  leave?: { type: LeaveType; label: string; paid: boolean };
  /** Set when a punch that day came from somewhere other than the registered device. */
  deviceAnomaly?: DeviceAnomaly | null;
  /** The machine that punch came from — named only when it was flagged. */
  deviceLabel?: string | null;
  /** A correction raised for this day, pending or already applied. */
  regularization?: {
    _id: string;
    type: RegularizationType;
    status: RegularizationStatus;
    resultingStatus?: RegularizationOutcome;
  };
}
export interface AttendanceCalendarEmployee {
  employee: { _id: string; name: string; employeeCode?: string; designation?: string };
  days: Record<string, AttendanceCalendarDay>;
  summary: Record<string, number>;
  /** When they were on the payroll — days outside it are nobody's to account for. */
  employment: { from: string | null; to: string | null };
}
export interface AttendanceCalendarData {
  month: string;
  year: number;
  daysInMonth: number;
  employees: AttendanceCalendarEmployee[];
}

// ─── One day, everybody ──────────────────────────────────────────────────────
/**
 * A blank day means two different things, so the day view names both: nobody
 * marked it (`not_marked`), or the person was not employed yet (`not_employed`).
 */
export type DayViewStatus = AttendanceStatus | "not_marked" | "not_employed";

export interface DailyAttendanceRow extends Omit<AttendanceCalendarDay, "status"> {
  employee: { _id: string; name: string; employeeCode?: string; designation?: string };
  status: DayViewStatus;
}
export interface DailyAttendanceData {
  date: string;
  isToday: boolean;
  isFuture: boolean;
  timeZone: string;
  /** Headcount per status, over the people the day applies to. */
  counts: Partial<Record<DayViewStatus, number>>;
  total: number;
  employees: DailyAttendanceRow[];
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

// ─── Dashboard (HR summary) ───────────────────────────────────────────────────
export interface BirthdayPerson {
  _id: string;
  name: string;
  employeeCode?: string;
  dob?: string;
  designation?: string;
  department?: string | null;
}
export interface AnniversaryPerson {
  _id: string;
  name: string;
  employeeCode?: string;
  joiningDate?: string;
  designation?: string;
  department?: string | null;
  years: number;
}
export interface DashboardWishes {
  birthdays: BirthdayPerson[];
  anniversaries: AnniversaryPerson[];
}
export interface LeaveLite {
  _id: string;
  user?: { _id: string; name: string; designation?: string } | string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatus;
}
export interface RegularizationLite {
  _id: string;
  user?: { _id: string; name: string; designation?: string } | string | null;
  type: RegularizationType;
  date: string;
  status: RegularizationStatus;
}
export interface NoticeLite {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string } | string | null;
  resignationDate: string;
  lastWorkingDay: string;
  noticePeriodDays: number;
}
export interface ExpiringDocument {
  /**
   * Whose document it is — null for anything that belongs to no one person: a
   * company licence, or an access card whose holder has no employee record.
   */
  employee: { _id: string; name: string; employeeCode?: string; designation?: string } | null;
  /** The entity a company document belongs to. Absent for a person's papers. */
  company?: string;
  /** Slug and reference, for company documents — label with `companyDocTypeLabel`. */
  documentType?: string;
  number?: string;
  /** "other" covers the free-form documents an employee can have any number of. */
  type: "passport" | "visa" | "labourCard" | "emiratesId" | "card" | "other" | "company";
  label: string;
  expiryDate: string;
  daysLeft: number;
  expired: boolean;
}
export interface OrgNode {
  _id: string;
  name: string;
  employeeCode?: string;
  designation?: string;
  department: string | null;
  photoUrl?: string;
  children: OrgNode[];
}
export interface OrgChart {
  roots: OrgNode[];
  total: number;
}
export interface DashboardSummary {
  date: string;
  birthdays: BirthdayPerson[];
  anniversaries: AnniversaryPerson[];
  onLeaveToday: LeaveLite[];
  workingFromHomeToday: LeaveLite[];
  pendingLeaves: LeaveLite[];
  pendingRegularizations: RegularizationLite[];
  servingNotice: NoticeLite[];
  expiringDocuments: ExpiringDocument[];
  upcomingBirthdays: UpcomingPerson[];
  upcomingAnniversaries: UpcomingPerson[];
  newJoiners: JoinerLite[];
  recentResignations: ResignationLite[];
  dueConfirmations: DueConfirmation[];
  counts: {
    birthdays: number; anniversaries: number; onLeaveToday: number; workingFromHomeToday: number;
    pendingLeaves: number; pendingRegularizations: number; servingNotice: number; expiringDocuments: number;
    upcomingBirthdays: number; upcomingAnniversaries: number; newJoiners: number;
    recentResignations: number; dueConfirmations: number;
  };
}

export interface UpcomingPerson {
  _id: string;
  name: string;
  employeeCode?: string;
  designation?: string;
  department?: string | null;
  date: string;
  daysUntil: number;
  /** Completed years at the upcoming anniversary. Absent for birthdays. */
  years?: number;
}

export interface JoinerLite {
  _id: string;
  name: string;
  employeeCode?: string;
  designation?: string;
  joiningDate: string;
  department?: { name: string } | string | null;
}

export interface ResignationLite {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string } | string | null;
  resignationDate: string;
  lastWorkingDay?: string;
  status: ResignationStatus;
}

// ─── Probation confirmation ─────────────────────────────────────────────────
export type ConfirmationStatus = "pending" | "confirmed" | "rejected";

export interface DueConfirmation {
  employee: {
    _id: string; name: string; employeeCode?: string; designation?: string;
    location?: string; joiningDate?: string; probationPeriodDays?: number;
  };
  dueDate: string;
  daysLeft: number;
  overdue: boolean;
  /** Set when a confirmation is already in flight for this employee. */
  pendingId?: string;
}

export interface Confirmation {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string; location?: string; joiningDate?: string; probationPeriodDays?: number } | string | null;
  dueDate?: string | null;
  confirmationDate: string;
  status: ConfirmationStatus;
  notes?: string;
  initiatedBy?: { _id: string; name: string } | string | null;
  reviewedBy?: { _id: string; name: string } | string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: ApprovalStepSnapshot[];
  approvalTrail?: ApprovalTrailEntry[];
  createdAt: string;
  updatedAt: string;
}

// ─── Announcements ────────────────────────────────────────────────────────────
export type AnnouncementCategory = "general" | "policy" | "event" | "celebration";
export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  general: "General", policy: "Policy", event: "Event", celebration: "Celebration",
};
export interface Announcement {
  _id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Surveys ──────────────────────────────────────────────────────────────────
export type SurveyQuestionType = "text" | "single_choice" | "rating";
export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  text: "Free text", single_choice: "Single choice", rating: "Rating (1–5)",
};
export type SurveyStatus = "draft" | "active" | "closed";
export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: "Draft", active: "Active", closed: "Closed",
};

export interface SurveyQuestion {
  _id: string;
  text: string;
  type: SurveyQuestionType;
  options: string[];
  required: boolean;
}

export interface Survey {
  _id: string;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  status: SurveyStatus;
  closesAt?: string | null;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the admin list — count of submitted responses. */
  responseCount?: number;
  /** Present on GET /surveys/mine — whether the caller already responded. */
  hasResponded?: boolean;
}

export interface SurveyAnswer {
  question: string;
  value: string | number;
}

export interface SurveyResponse {
  _id: string;
  survey: string;
  user: string;
  answers: SurveyAnswer[];
  submittedAt: string;
}

export interface SurveyResultQuestion {
  questionId: string;
  text: string;
  type: SurveyQuestionType;
  responseCount: number;
  average?: number;
  distribution?: Record<number, number>;
  counts?: Record<string, number>;
  textAnswers?: string[];
}

export interface SurveyResults {
  survey: Survey;
  totalResponses: number;
  questions: SurveyResultQuestion[];
}

// ─── Helpdesk ─────────────────────────────────────────────────────────────────
export type HelpdeskCategory = "it" | "hr" | "payroll" | "facilities" | "other";
export const HELPDESK_CATEGORY_LABELS: Record<HelpdeskCategory, string> = {
  it: "IT", hr: "HR", payroll: "Payroll", facilities: "Facilities", other: "Other",
};
export type HelpdeskPriority = "low" | "medium" | "high";
export const HELPDESK_PRIORITY_LABELS: Record<HelpdeskPriority, string> = {
  low: "Low", medium: "Medium", high: "High",
};
export type HelpdeskStatus = "open" | "in_progress" | "resolved" | "closed";
export const HELPDESK_STATUS_LABELS: Record<HelpdeskStatus, string> = {
  open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed",
};

export interface HelpdeskComment {
  author?: { _id: string; name: string } | string | null;
  body: string;
  at: string;
}

export interface HelpdeskTicket {
  _id: string;
  subject: string;
  description: string;
  category: HelpdeskCategory;
  priority: HelpdeskPriority;
  status: HelpdeskStatus;
  createdBy?: { _id: string; name: string; email?: string } | string | null;
  assignedTo?: { _id: string; name: string; email?: string } | string | null;
  comments: HelpdeskComment[];
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Reports / MIS builder ──────────────────────────────────────────────────
export type ReportSourceKey = "employees" | "attendance" | "leave" | "reimbursements" | "payslips";

export interface ReportColumn {
  key: string;
  label: string;
}
export interface ReportFilterOption {
  value: string;
  label: string;
}
export interface ReportFilter {
  key: string;
  label: string;
  type: "date" | "select";
  options?: ReportFilterOption[];
}
export interface ReportSource {
  key: ReportSourceKey;
  label: string;
  columns: ReportColumn[];
  filters: ReportFilter[];
}
export type ReportRow = Record<string, string | number | null>;
export interface ReportRunResult {
  rows: ReportRow[];
}
export interface ReportFilterValues {
  status?: string;
  department?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ─── Performance management ─────────────────────────────────────────────────
export type PerformanceCycleStatus = "draft" | "active" | "closed";
export const PERFORMANCE_CYCLE_STATUS_LABELS: Record<PerformanceCycleStatus, string> = {
  draft: "Draft", active: "Active", closed: "Closed",
};
export type AppraisalStatus = "draft" | "submitted" | "completed";
export const APPRAISAL_STATUS_LABELS: Record<AppraisalStatus, string> = {
  draft: "Draft", submitted: "Awaiting review", completed: "Completed",
};

export interface PerformanceCycle {
  _id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: PerformanceCycleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AppraisalGoal {
  _id: string;
  title: string;
  description?: string;
  weight: number;
  selfRating?: number | null;
  managerRating?: number | null;
}

export interface Appraisal {
  _id: string;
  cycle: { _id: string; title: string; startDate: string; endDate: string; status: PerformanceCycleStatus } | string;
  employee?: { _id: string; name: string; employeeCode: string; designation?: string } | string | null;
  goals: AppraisalGoal[];
  selfComment?: string;
  managerComment?: string;
  status: AppraisalStatus;
  overallRating?: number | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  reviewedBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export type CardStatus = "active" | "expired";
export const CARD_STATUS_LABELS: Record<CardStatus, string> = { active: "Active", expired: "Expired" };

export interface Card {
  _id: string;
  cardNumber: string;
  name: string;
  client?: { _id: string; name: string; email?: string } | string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  notes?: string;
  status?: CardStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Resignation ──────────────────────────────────────────────────────────────
export type ResignationStatus = "pending" | "accepted" | "rejected" | "withdrawn" | "relieved";
export const RESIGNATION_STATUS_LABELS: Record<ResignationStatus, string> = {
  pending: "Pending",
  accepted: "Serving notice",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  relieved: "Relieved",
};

export type ResignationType = "resignation" | "termination" | "retirement" | "end_of_contract" | "absconding";
export const RESIGNATION_TYPE_LABELS: Record<ResignationType, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  end_of_contract: "End of contract",
  absconding: "Absconding",
};

export type PaymentType = "cash" | "bank_transfer" | "cheque";
export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};

export interface Resignation {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string; department?: DepartmentSimple | string | null } | string | null;
  user?: { _id: string; name: string; email?: string } | string | null;
  resignationType: ResignationType;
  resignationDate: string;
  noticeRequired: boolean;
  noticePeriodDays: number;
  lastWorkingDay: string;
  reason?: string;
  status: ResignationStatus;
  leavingDate?: string | null;
  finalSettlement?: number | null;
  left?: boolean;
  noticePeriodServed?: boolean;
  leaveSalaryPaid?: boolean;
  ticketAllowancePaid?: boolean;
  paymentType?: PaymentType | null;
  remarks?: string;
  settlement?: FinalSettlement | null;
  clearance?: ClearanceItem[];
  exitInterview?: ExitInterview | null;
  reviewedBy?: { _id: string; name: string } | string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export const CLEARANCE_DEPARTMENTS = ["it", "finance", "hr", "admin", "manager"] as const;
export type ClearanceDepartment = (typeof CLEARANCE_DEPARTMENTS)[number];
export const CLEARANCE_DEPT_LABELS: Record<ClearanceDepartment, string> = {
  it: "IT", finance: "Finance", hr: "HR", admin: "Admin", manager: "Manager",
};
export type ClearanceStatus = "pending" | "cleared" | "not_applicable";

export interface ClearanceItem {
  _id: string;
  department: ClearanceDepartment;
  item: string;
  status: ClearanceStatus;
  notes?: string;
  clearedBy?: { _id: string; name: string } | string | null;
  clearedAt?: string | null;
}

export const EXIT_REASONS = [
  "compensation", "career_growth", "work_life_balance", "management",
  "relocation", "higher_studies", "health", "role_mismatch", "other",
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];
export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  compensation: "Compensation",
  career_growth: "Career growth",
  work_life_balance: "Work-life balance",
  management: "Management",
  relocation: "Relocation",
  higher_studies: "Higher studies",
  health: "Health",
  role_mismatch: "Role mismatch",
  other: "Other",
};

export const EXIT_RATING_FIELDS = [
  { key: "workEnvironment", label: "Work environment" },
  { key: "management", label: "Management" },
  { key: "growth", label: "Growth opportunities" },
  { key: "compensation", label: "Compensation" },
  { key: "workLifeBalance", label: "Work-life balance" },
] as const;

export interface ExitInterview {
  conductedBy?: { _id: string; name: string } | string | null;
  conductedAt?: string | null;
  primaryReason?: ExitReason;
  ratings?: Partial<Record<(typeof EXIT_RATING_FIELDS)[number]["key"], number | null>>;
  whatWentWell?: string;
  whatCouldImprove?: string;
  wouldRecommend?: boolean | null;
  eligibleForRehire?: boolean | null;
  notes?: string;
}

export interface SettlementLine {
  label: string;
  amount: number;
}
export interface FinalSettlement {
  computedAt?: string;
  basic: number;
  dayRate: number;
  tenureYears: number;
  gratuity: number;
  leaveEncashmentDays: number;
  noticeShortfallDays: number;
  earnings: SettlementLine[];
  deductions: SettlementLine[];
  totalEarnings: number;
  totalDeductions: number;
  netPayable: number;
  currency: string;
  settled: boolean;
  settledAt?: string | null;
  notes?: string;
}
export interface SettlementInput {
  leaveEncashmentDays?: number;
  noticeShortfallDays?: number;
  gratuityOverride?: number | null;
  extraEarnings?: SettlementLine[];
  extraDeductions?: SettlementLine[];
  notes?: string;
}

// ─── Loan ─────────────────────────────────────────────────────────────────────
export type LoanStatus = "active" | "closed" | "cancelled";
export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

export interface Loan {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string; currency?: string } | string | null;
  user?: { _id: string; name: string; email?: string } | string | null;
  amount: number;
  purpose?: string;
  disbursedDate?: string | null;
  installments: number;
  monthlyDeduction: number;
  amountRepaid: number;
  status: LoanStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Salary increment ─────────────────────────────────────────────────────────
export interface SalaryIncrement {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; currency?: string; salary?: number } | string | null;
  previousSalary: number;
  newSalary: number;
  effectiveMonth: string;
  reason?: string;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Onboarding task checklists ────────────────────────────────────────────────
export type OnboardingTaskCategory = "documentation" | "it_setup" | "hr" | "facilities" | "training";
export type OnboardingAssigneeRole = "hr" | "it" | "manager" | "employee";
export type OnboardingTaskStatus = "pending" | "completed";

export const ONBOARDING_CATEGORY_LABELS: Record<OnboardingTaskCategory, string> = {
  documentation: "Documentation", it_setup: "IT Setup", hr: "HR", facilities: "Facilities", training: "Training",
};
export const ONBOARDING_ASSIGNEE_LABELS: Record<OnboardingAssigneeRole, string> = {
  hr: "HR", it: "IT", manager: "Manager", employee: "Employee",
};

export interface OnboardingTemplateTask {
  _id: string;
  title: string;
  description?: string;
  category: OnboardingTaskCategory;
  assigneeRole: OnboardingAssigneeRole;
  dueDayOffset: number;
}
export interface OnboardingTemplate {
  _id: string;
  name: string;
  description?: string;
  tasks: OnboardingTemplateTask[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingChecklistTask {
  _id: string;
  title: string;
  description?: string;
  category: OnboardingTaskCategory;
  assigneeRole: OnboardingAssigneeRole;
  dueDate?: string | null;
  status: OnboardingTaskStatus;
  completedAt?: string | null;
  completedBy?: { _id: string; name: string } | string | null;
}
export interface OnboardingChecklist {
  _id: string;
  employee: { _id: string; name: string; employeeCode: string; designation?: string; department?: string; joiningDate?: string | null } | string;
  templateName: string;
  tasks: OnboardingChecklistTask[];
  createdAt: string;
  updatedAt: string;
}

// ─── Letters & templates engine ────────────────────────────────────────────────
export type LetterCategory = "offer" | "appointment" | "confirmation" | "experience" | "relieving" | "warning" | "other";

export const LETTER_CATEGORY_LABELS: Record<LetterCategory, string> = {
  offer: "Offer", appointment: "Appointment", confirmation: "Confirmation",
  experience: "Experience", relieving: "Relieving", warning: "Warning", other: "Other",
};

export interface LetterTemplate {
  _id: string;
  name: string;
  category: LetterCategory;
  subject?: string;
  body: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedLetter {
  _id: string;
  employee: { _id: string; name: string; employeeCode?: string; designation?: string } | string;
  template?: { _id: string; name: string } | string | null;
  templateName: string;
  category: LetterCategory;
  subject: string;
  content: string;
  issuedBy?: { _id: string; name: string } | string | null;
  /** Who issued it — printed as the letterhead. */
  organization?: { _id: string; name: string } | string | null;
  issuedAt: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Comp-off (compensatory time off) ──────────────────────────────────────────
export interface CompOffCredit {
  _id: string;
  employee: { _id: string; name: string; employeeCode?: string; designation?: string } | string;
  date: string;
  amount: number;
  reason?: string;
  status: "available" | "revoked";
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompOffSuggestion {
  employee: { _id: string; name: string; employeeCode?: string };
  user: string;
  date: string;
  reason: "holiday" | "weekend";
  workedMinutes: number;
}

// ─── Face enrollment (kiosk attendance) ─────────────────────────────────────
export interface FaceSettings {
  /** False when the recognition service is not configured on the server. */
  enabled: boolean;
  /** The organisation asks for a face, and the service exists to take one. */
  required?: boolean;
  minCaptures: number;
  maxCaptures: number;
  /** Exact wording the employee must agree to before enrollment. */
  consentText: string;
  /** False when kiosks punch from a single frame — a photo will then work. */
  livenessRequired?: boolean;
}

export interface FaceStatus {
  enrolled: boolean;
  captures: number;
  modelPack?: string;
  referenceUrl?: string | null;
  enrolledAt?: string;
  updatedAt?: string;
  consentAt?: string;
}

// ─── Kiosk devices (face check-in) ──────────────────────────────────────────
export interface Kiosk {
  _id: string;
  name: string;
  location?: string;
  /** Last four characters of the device secret, to tell devices apart. */
  tokenHint: string;
  active: boolean;
  lastSeenAt?: string | null;
  lastSeenIp?: string | null;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned only at pairing or rotation — the token is never readable again. */
export interface PairedKiosk {
  id: string;
  name: string;
  token: string;
}

export type PunchStatus =
  | "punched"
  | "cooldown"
  | "not_recognised"
  | "not_live"
  | "challenge_expired"
  | "refused";

export interface KioskPunchResult {
  status: PunchStatus;
  direction?: "in" | "out";
  user?: { id: string; name: string };
  at?: string;
  score?: number;
  lateMinutes?: number;
  reason?: string;
  hint?: string;
  message?: string;
}

// ─── Documents overview ──────────────────────────────────────────────────────
/**
 * `missing` is a required slot with nothing filed; `not_uploaded` the same for
 * an optional one. Both are absences — the distinction is whether anyone has to
 * do something about it.
 */
export type DocumentStatus = "missing" | "expired" | "expiring" | "valid" | "not_uploaded" | "ignored";

export interface DocumentRow {
  employee: {
    _id: string;
    name: string;
    employeeCode?: string;
    designation?: string;
    department: string | null;
    location: EmployeeLocation | null;
  };
  /** Requirement key, or `other:<id>` for a free-form entry. */
  slot: string;
  label: string;
  required: boolean;
  number: string;
  issueDate: string | null;
  expiryDate: string | null;
  /** Negative once expired. Null when the document has no expiry to track. */
  daysToExpiry: number | null;
  file: { fileName: string; url: string; uploadedAt: string | null; mimeType?: string; size?: number } | null;
  status: DocumentStatus;
  /** Set when somebody has decided this one is not worth chasing. */
  ignored: { reason: string; at: string | null } | null;
  /** What the status would be if it were not ignored. */
  underlyingStatus: DocumentStatus;
}

/** One row, addressed the way the server identifies it. */
export interface DocumentRef {
  employee: string;
  slot: string;
}

/**
 * A document the business itself holds — a trade licence, a tenancy contract.
 *
 * Not an employee document with the person left blank: it has a company rather
 * than an owner, and it exists only once somebody adds it, so it is never
 * "missing" the way a required employee slot can be.
 */
export interface CompanyDocument {
  _id: string;
  companyName: string;
  /** Slug — "trade_licence". Label it with `companyDocTypeLabel`. */
  documentType: string;
  number: string;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string;
  size?: number;
  uploadedAt: string | null;
  daysToExpiry: number | null;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

/** The kinds people file most often. Anything else is accepted and slugged. */
export const COMPANY_DOC_TYPE_LABELS: Record<string, string> = {
  trade_licence: "Trade licence",
  establishment_card: "Establishment card",
  immigration_card: "Immigration card",
  chamber_of_commerce: "Chamber of Commerce",
  tenancy_contract: "Tenancy contract",
  ejari: "Ejari",
  vat_certificate: "VAT certificate",
  tax_card: "Tax card",
  insurance: "Insurance policy",
  bank_guarantee: "Bank guarantee",
  municipality_permit: "Municipality permit",
  civil_defence: "Civil defence certificate",
  moe_permit: "Ministry of Education permit",
  lease_agreement: "Lease agreement",
  other: "Other",
};

/** The label we know, or the slug made readable. */
export const companyDocTypeLabel = (t?: string | null): string =>
  (t && COMPANY_DOC_TYPE_LABELS[t]) ||
  (t ? t.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase()) : "—");

export interface CompanyDocumentsResponse {
  rows: CompanyDocument[];
  counts: Partial<Record<DocumentStatus, number>>;
  total: number;
  within: number;
  companies: string[];
  types: string[];
}

export interface DocumentsOverview {
  rows: DocumentRow[];
  /** Bucket sizes over every slot, not just the ones currently filtered in. */
  counts: Partial<Record<DocumentStatus, number>>;
  total: number;
  within: number;
  employees: number;
}

// ─── Hiring ──────────────────────────────────────────────────────────────────
export type RequisitionType = "replacement" | "new_headcount";
export type RequisitionStatus = "draft" | "pending" | "approved" | "rejected" | "on_hold" | "filled" | "cancelled";

export const REQUISITION_TYPE_LABELS: Record<RequisitionType, string> = {
  replacement: "Replacement",
  new_headcount: "New headcount",
};
export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: "Draft", pending: "Pending", approved: "Approved", rejected: "Rejected",
  on_hold: "On hold", filled: "Filled", cancelled: "Cancelled",
};

export interface JobRequisition {
  _id: string;
  type: RequisitionType;
  replacing?: { _id: string; name: string; employeeCode?: string; designation?: string; salary?: number } | string | null;
  replacingSalary?: number | null;
  /** Whether Finance had to sign off — frozen when the request was raised. */
  budgetApprovalRequired: boolean;
  title: string;
  department?: { _id: string; name: string } | string | null;
  designation?: string;
  location?: EmployeeLocation;
  employmentType?: EmploymentType;
  headcount: number;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  justification?: string;
  targetStartDate?: string | null;
  raisedBy?: { _id: string; name: string; email?: string } | string | null;
  status: RequisitionStatus;
  workflowStep?: number | null;
  workflowTotalSteps?: number | null;
  approvalSteps?: { order: number; roleName: string; label?: string }[];
  approvalTrail?: { step: number; roleName?: string; by?: { _id: string; name: string } | string; action: string; note?: string; at: string }[];
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

/** Whether the organization has actually configured a hiring approval chain. */
export interface HiringWorkflowState {
  configured: boolean;
  steps: { order: number; when: string; roleName: string; label?: string }[];
}

export const APPLICATION_STAGES = ["applied","screening","shortlisted","interview","offer","accepted","hired"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
/** `waitlisted` is a parking space, not an ending — it can be pulled back. */
export type ApplicationStatus = "active" | "waitlisted" | "rejected" | "withdrawn";
export type OfferApprovalStatus = "not_requested" | "pending" | "approved" | "rejected";

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  active: "In play", waitlisted: "Waiting list", rejected: "Rejected", withdrawn: "Withdrew",
};

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: "Applied", screening: "Screening", shortlisted: "Shortlisted",
  interview: "Interview", offer: "Offer", accepted: "Accepted", hired: "Hired",
};

export interface Candidate {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  source?: string;
  currentCompany?: string;
  currentDesignation?: string;
  totalExperienceYears?: number;
  noticePeriodDays?: number;
  expectedSalary?: number;
  currency?: string;
  location?: string;
  /** Signed and short-lived — minted per response, never stored. */
  resumeUrl?: string;
  resumeFileName?: string;
  links?: string[];
  notes?: string;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the single-candidate response. */
  applications?: Application[];
}

export interface Application {
  _id: string;
  requisition: { _id: string; title: string; status?: string } | string;
  candidate: Candidate | string;
  stage: ApplicationStage;
  status: ApplicationStatus;
  rating?: number | null;
  offeredSalary?: number | null;
  rejectionReason?: string;
  stageHistory?: { stage: string; by?: { _id: string; name: string } | string; at: string; note?: string }[];
  /** Attached by the pipeline and candidate endpoints so a card can say whether
   *  anyone has actually spoken to them. */
  interviews?: Interview[];
  movedToEmployee?: string | null;
  /** Management's sign-off on releasing the offer. */
  offerApproval?: {
    status: OfferApprovalStatus;
    requestedBy?: { _id: string; name: string } | string | null;
    requestedAt?: string | null;
    decidedBy?: { _id: string; name: string } | string | null;
    decidedAt?: string | null;
    note?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  columns: { stage: ApplicationStage; applications: Application[] }[];
  /** Rejected and withdrawn, kept visible — a pipeline that hides them looks healthier than it is. */
  closed: Application[];
  total: number;
}

export type InterviewMode = "in_person" | "video" | "phone";
export type InterviewStatus = "scheduled" | "completed" | "no_show" | "cancelled";
export type Recommendation = "strong_yes" | "yes" | "no" | "strong_no";

export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  in_person: "In person", video: "Video call", phone: "Phone",
};
export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Scheduled", completed: "Completed", no_show: "No show", cancelled: "Cancelled",
};
/** Kept distinct rather than averaged — a split panel is the useful signal. */
export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_yes: "Strong yes", yes: "Yes", no: "No", strong_no: "Strong no",
};

export interface Interview {
  _id: string;
  application: string | Application;
  round: number;
  title?: string;
  mode: InterviewMode;
  scheduledAt: string;
  durationMinutes: number;
  timeZone: string;
  location?: string;
  meetingLink?: string;
  /** A pointer to a recording held wherever the meeting tool put it. */
  recordingLink?: string;
  panel: Array<{ _id: string; name: string; email?: string }> | string[];
  status: InterviewStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Present on the single-interview response. */
  feedback?: InterviewFeedback[];
}

export interface InterviewFeedback {
  _id: string;
  interview: string;
  panellist: { _id: string; name: string; email?: string } | string;
  recommendation: Recommendation;
  scores?: { skill: string; rating: number }[];
  notes?: string;
  submittedAt: string;
}

/** Who on the panel is already booked. Advisory — the form warns, not refuses. */
export interface PanelConflict {
  user: string;
  name: string;
  clashesWith: string;
  at: string;
}

// ─── Approvals console ────────────────────────────────────────────────────────
export const APPROVAL_MODULES = [
  "leave", "regularization", "reimbursement", "confirmation",
  "hiring", "offer", "resignation", "agreement",
] as const;
export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

/** Where each row goes when you want the record in its own module. */
export const APPROVAL_MODULE_HREF: Record<ApprovalModule, string> = {
  leave: "/leave",
  regularization: "/regularization",
  reimbursement: "/reimbursements",
  confirmation: "/confirmations",
  hiring: "/hiring",
  offer: "/hiring/candidates",
  resignation: "/resignations",
  agreement: "/agreements",
};

export interface ApprovalDecision {
  outcome: "approved" | "rejected";
  at: string | null;
  by: { id: string | null; name: string } | null;
  note: string | null;
}

/** Seven record shapes, normalised to one row. */
export interface ApprovalRow {
  id: string;
  module: ApprovalModule;
  moduleLabel: string;
  organization: { id: string | null; name: string | null };
  title: string;
  raisedBy: { id: string | null; name: string } | null;
  raisedAt: string | null;
  summary: Array<{ label: string; value: string }>;
  chain: { step: number; total: number; waitingOn: string } | null;
  href: string;
  /** Only on the decided view. */
  decided?: ApprovalDecision | null;
}

export interface ApprovalInbox {
  rows: ApprovalRow[];
  counts: Partial<Record<ApprovalModule, number>>;
  total: number;
  /** Modules whose queue hit the per-module cap, so the list is not all of it. */
  capped: ApprovalModule[];
  limit: number;
  /** Server-owned, so the console and the dashboard agree on "stuck". */
  staleAfterDays: number;
}

/** Counts only — what the dashboard card needs, without the rows. */
export interface ApprovalSummary {
  /**
   * Whether this person has any approvals at all.
   *
   * The summary answers rather than refuses so the sidebar can ask it on every
   * page load without a hundred employees generating a 403 apiece. False means
   * the counts below are zeroes standing in for "nothing here", not an empty
   * queue somebody is entitled to look at — so the link is not drawn.
   */
  canAccess: boolean;
  total: number;
  stale: number;
  staleAfterDays: number;
  oldestRaisedAt: string | null;
  /** Organisations with something waiting, not organisations that exist. */
  organizations: number;
  byModule: Array<{
    module: ApprovalModule;
    label: string;
    count: number;
    oldest: string | null;
    stale: number;
  }>;
}

export interface ApprovalDetail {
  row: ApprovalRow;
  record: Record<string, unknown>;
}

export interface BulkDecideResult {
  requested: number;
  succeeded: number;
  failed: Array<{ id: string; ok: false; error: string }>;
}

// ─── Onboarding agreements ────────────────────────────────────────────────────
export type AgreementVariant = "onsite" | "remote";
export type AgreementKind = "nda" | "tc";
export const AGREEMENT_KIND_LABELS: Record<AgreementKind, string> = {
  nda: "Non-disclosure & non-compete",
  tc: "Terms & conditions",
};

export interface InductionProgress {
  duration: number;
  watchedSeconds: number;
  lastPosition: number;
  completed: boolean;
  completedAt: string | null;
  skipAttempts: number;
  /** Credited progress, not playhead — scrubbing moves the playhead and not this. */
  percent: number;
}

export interface AgreementState {
  /** The organization holds new joiners at this gate. Off until HR turns it on. */
  required: boolean;
  variant: AgreementVariant;
  documents: Array<{ kind: AgreementKind; title: string; version: number; url: string; fileName?: string }>;
  video: { title: string; durationSeconds: number; url: string } | null;
  videoCompleted: boolean;
  agreement: {
    _id: string;
    status: "pending" | "approved" | "rejected";
    signedAt: string;
    reviewNote?: string;
    /** The signed copies — their name and signature on the document. */
    documents: Array<{ kind: AgreementKind; version: number; url: string }>;
  } | null;
  /** Onboarding also asks for a face — and the matching service is reachable. */
  faceRequired: boolean;
  faceEnrolled: boolean;
  cleared: boolean;
}

/** One person's signing, as HR reviews it. */
export interface SignedAgreementRow {
  _id: string;
  employee?: { _id: string; name: string; employeeCode?: string; designation?: string } | string | null;
  variant: AgreementVariant;
  typedName: string;
  status: "pending" | "approved" | "rejected";
  signedAt: string;
  signedIp?: string | null;
  reviewNote?: string;
  reviewedAt?: string | null;
  signatureUrl: string;
  documents: Array<{ kind: AgreementKind; version: number; url: string; sourceSha256?: string }>;
  videoView?: { watchedSeconds?: number; completedAt?: string | null; skipAttempts?: number } | null;
  createdAt: string;
}

export interface AgreementTemplateRow {
  _id: string; kind: AgreementKind; variant: AgreementVariant; version: number;
  fileName?: string; url: string; sha256: string; createdAt: string;
}


// ─── Notifications ───────────────────────────────────────────────────────────
export type NotificationKind =
  | "leave" | "regularization" | "approval" | "announcement" | "payroll" | "system";

export interface AppNotification {
  _id: string;
  kind: NotificationKind;
  /** Approved, rejected, or simply something to know about. */
  tone: "positive" | "negative" | "neutral";
  title: string;
  body: string;
  /** Where clicking it goes. Empty when there is nowhere useful to send them. */
  href: string;
  /** Who caused it, when a person did. */
  actor?: { _id: string; name: string } | null;
  readAt: string | null;
  createdAt: string;
}

/** One thing the global search box found, whatever kind of thing it is. */
export interface SearchHit {
  id: string;
  /** Which source it came from, for grouping and the icon. */
  group: string;
  title: string;
  subtitle: string;
  href: string;
}
