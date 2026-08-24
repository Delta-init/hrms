import { z } from "zod";

const employmentType = z.enum(["full_time", "part_time", "contract", "intern"]);
const status = z.enum(["active", "probation", "on_leave", "notice_period", "terminated"]);
const title = z.enum(["mr", "mrs", "ms", "dr"]);
const gender = z.enum(["male", "female", "other"]);
const marital = z.enum(["married", "unmarried"]);
const location = z.enum(["india", "dubai"]);
const workMode = z.enum(["office", "wfh"]);

const educationSchema = z.object({
  qualification: z.string().max(120).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  institute: z.string().max(160).optional(),
});
const addressSchema = z.object({
  address: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
});
const emergencySchema = z.object({
  name: z.string().max(100).optional(),
  relation: z.string().max(60).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  phoneNumber: z.string().max(30).optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});
const bankSchema = z.object({
  bankAccountNumber: z.string().max(40).optional(),
  ibanIfsc: z.string().max(40).optional(),
  bankName: z.string().max(120).optional(),
  nameInBank: z.string().max(120).optional(),
});
const familyMemberSchema = z.object({
  name: z.string().max(100).optional(),
  relation: z.string().max(60).optional(),
  dob: z.coerce.date().optional().nullable(),
  phone: z.string().max(30).optional(),
});
const passportSchema = z.object({
  passportNumber: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
});
const visaSchema = z.object({
  country: z.string().max(80).optional(),
  type: z.string().max(60).optional(),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
});
const labourCardSchema = z.object({
  cardNumber: z.string().max(40).optional(),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
});
const emiratesIdSchema = z.object({
  idNumber: z.string().max(40).optional(),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
});

// Extended profile fields — all optional, shared by create + update.
const profileFields = {
  title: title.optional(),
  gender: gender.optional(),
  personalEmail: z.string().email("Invalid email").optional().or(z.literal("")).nullable(),
  mobileNumber: z.string().max(30).optional().nullable(),
  dob: z.coerce.date().optional().nullable(),
  bloodGroup: z.string().max(8).optional().nullable(),
  nationality: z.string().max(80).optional().nullable(),
  maritalStatus: marital.optional(),
  oldCompanyExperience: z.string().max(1000).optional().nullable(),
  confirmationDate: z.coerce.date().optional().nullable(),
  probationPeriodDays: z.coerce.number().min(0).optional(),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  reportingTo: z.string().optional().nullable(),
  reportingToKind: z.enum(["Employee", "User"]).optional(),
  bank: bankSchema.optional(),
  education: z.array(educationSchema).optional(),
  currentAddress: addressSchema.optional(),
  permanentAddress: addressSchema.optional(),
  emergencyContacts: z.array(emergencySchema).optional(),
  familyMembers: z.array(familyMemberSchema).optional(),
  passport: passportSchema.optional(),
  visa: visaSchema.optional(),
  labourCard: labourCardSchema.optional(),
  emiratesId: emiratesIdSchema.optional(),
};

/** Provision a login in the same step as the employee. */
const inlineLoginSchema = z.object({
  role: z.string().min(1, "Role is required"),
  /** Defaults to the employee's own email. */
  email: z.string().email("Invalid email").optional(),
});

export const createEmployeeSchema = z.object({
  login: inlineLoginSchema.optional(),
  employeeCode: z.string().min(1, "Employee code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  department: z.string().optional().nullable(),
  designation: z.string().max(100).optional(),
  workSchedule: z.string().optional().nullable(),
  user: z.string().optional().nullable(),
  employmentType: employmentType.default("full_time"),
  joiningDate: z.coerce.date().optional().nullable(),
  status: status.default("active"),
  location: location.optional(),
  workMode: workMode.default("office"),
  salary: z.coerce.number().min(0).optional(),
  currency: z.string().max(6).optional(),
  ...profileFields,
});

export const updateEmployeeSchema = z.object({
  employeeCode: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(100).optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")).nullable(),
  phone: z.string().max(30).optional().nullable(),
  department: z.string().optional().nullable(),
  designation: z.string().max(100).optional().nullable(),
  workSchedule: z.string().optional().nullable(),
  user: z.string().optional().nullable(),
  employmentType: employmentType.optional(),
  joiningDate: z.coerce.date().optional().nullable(),
  status: status.optional(),
  location: location.optional().nullable(),
  // Not nullable, unlike `location`: how somebody punches has to resolve to an
  // answer, and clearing it back to nothing would leave that undecidable.
  workMode: workMode.optional(),
  salary: z.coerce.number().min(0).optional(),
  currency: z.string().max(6).optional(),
  ...profileFields,
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

// Self-service profile edit: personal-information sections only. Deliberately
// excludes employeeCode/name/work email&phone/department/designation/status/
// salary/reportingTo/passport/visa — those stay admin-only (via updateEmployeeSchema).
export const updateMyProfileSchema = z.object({
  title: profileFields.title,
  gender: profileFields.gender,
  personalEmail: profileFields.personalEmail,
  mobileNumber: profileFields.mobileNumber,
  dob: profileFields.dob,
  bloodGroup: profileFields.bloodGroup,
  nationality: profileFields.nationality,
  maritalStatus: profileFields.maritalStatus,
  oldCompanyExperience: profileFields.oldCompanyExperience,
  bank: profileFields.bank,
  education: profileFields.education,
  currentAddress: profileFields.currentAddress,
  permanentAddress: profileFields.permanentAddress,
  emergencyContacts: profileFields.emergencyContacts,
  familyMembers: profileFields.familyMembers,
});

export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

// Provision a login account for an employee (they set their own password on first login).
export const createLoginSchema = z.object({
  email: z.string().email("Invalid email").optional(),
  role: z.string().min(1, "Role is required"),
  // Optional: left out, the server generates one. Creating the login alongside
  // the employee has nowhere to type a password, and a generated one is
  // stronger than what gets typed into that box in practice.
  temporaryPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    )
    .optional(),
});

export type CreateLoginInput = z.infer<typeof createLoginSchema>;
