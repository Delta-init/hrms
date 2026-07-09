import { z } from "zod";

const employmentType = z.enum(["full_time", "part_time", "contract", "intern"]);
const status = z.enum(["active", "probation", "on_leave", "terminated"]);
const title = z.enum(["mr", "mrs", "ms", "dr"]);
const gender = z.enum(["male", "female", "other"]);
const marital = z.enum(["married", "unmarried"]);

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
  reportingTo: z.string().optional().nullable(),
  reportingToKind: z.enum(["Employee", "User"]).optional(),
  bank: bankSchema.optional(),
  education: z.array(educationSchema).optional(),
  currentAddress: addressSchema.optional(),
  permanentAddress: addressSchema.optional(),
  emergencyContacts: z.array(emergencySchema).optional(),
};

export const createEmployeeSchema = z.object({
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
  location: z.string().max(120).optional(),
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
  location: z.string().max(120).optional().nullable(),
  salary: z.coerce.number().min(0).optional(),
  currency: z.string().max(6).optional(),
  ...profileFields,
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

// Provision a login account for an employee (they set their own password on first login).
export const createLoginSchema = z.object({
  email: z.string().email("Invalid email").optional(),
  role: z.string().min(1, "Role is required"),
  temporaryPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

export type CreateLoginInput = z.infer<typeof createLoginSchema>;
