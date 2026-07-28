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
  "cards",
  "resignations",
  "loans",
  "salaryIncrements",
  "reimbursements",
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
  leave: "Leave",
  payroll: "Payroll",
  regularization: "Regularization",
  workSchedules: "Work Schedules",
  cards: "Cards",
  resignations: "Resignations",
  loans: "Loans",
  salaryIncrements: "Salary Increments",
  reimbursements: "Reimbursements",
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
export type OrganizationSimple = Pick<Organization, "_id" | "name" | "code" | "logo">;

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
export type EmployeeStatus = "active" | "probation" | "on_leave" | "notice_period" | "terminated";

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
  notice_period: "Notice Period",
  terminated: "Terminated",
};

export type Title = "mr" | "mrs" | "ms" | "dr";
export type Gender = "male" | "female" | "other";
export type MaritalStatus = "married" | "unmarried";
export type EmployeeLocation = "india" | "dubai";
export const LOCATION_LABELS: Record<EmployeeLocation, string> = { india: "India", dubai: "Dubai" };

// ─── Employee documents (location-driven onboarding) ─────────────────────────
export type DocumentType =
  | "passport"
  | "visa_copy"
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
  location?: EmployeeLocation;
  salary?: number;
  currency?: string;
  photo?: string;
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
  lopAmount: number;
  loanTotal: number;
  oneTimePayments: number;
  oneTimeDeductions: number;
  /** Approved expense reimbursements paid out this month (earnings). */
  reimbursements: number;
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
export interface Reimbursement {
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
  status: AttendanceStatus;
  workedMinutes?: number;
  checkIn?: string | null;
  checkOut?: string | null;
  lateMinutes?: number;
  note?: string;
  timeZone?: string | null;
}
export interface AttendanceCalendarEmployee {
  employee: { _id: string; name: string; employeeCode?: string; designation?: string };
  days: Record<string, AttendanceCalendarDay>;
  summary: Record<string, number>;
}
export interface AttendanceCalendarData {
  month: string;
  year: number;
  daysInMonth: number;
  employees: AttendanceCalendarEmployee[];
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
export interface DashboardSummary {
  date: string;
  birthdays: BirthdayPerson[];
  onLeaveToday: LeaveLite[];
  pendingLeaves: LeaveLite[];
  pendingRegularizations: RegularizationLite[];
  servingNotice: NoticeLite[];
  counts: { birthdays: number; onLeaveToday: number; pendingLeaves: number; pendingRegularizations: number; servingNotice: number };
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
  reviewedBy?: { _id: string; name: string } | string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
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
