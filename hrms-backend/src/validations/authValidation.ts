import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

// Used by the admin-invite / first-password flow: an invited user sets their
// password using their email + the temporary password issued by the admin.
export const setPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  temporaryPassword: z.string().min(1, "Temporary password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

// ── Onboarding: mandatory profile the user fills on first login ──────────────
const req = (msg: string, max = 200) => z.string().min(1, msg).max(max);
const opt = (max = 200) => z.string().max(max).optional().or(z.literal(""));

// One education row: the first (required) is shaped identically to the rest
// (optional) — the array's own .min(1) is what actually makes the first one
// mandatory, so the row itself doesn't need two variants.
const educationRow = z.object({
  qualification: z.string().max(120).optional().or(z.literal("")),
  from: z.string().max(20).optional().or(z.literal("")),
  to: z.string().max(20).optional().or(z.literal("")),
  institute: z.string().max(160).optional().or(z.literal("")),
  fieldOfStudy: opt(120),
  grade: opt(20),
});
const previousExperienceRow = z.object({
  organisation: z.string().max(160).optional().or(z.literal("")),
  designation: z.string().max(120).optional().or(z.literal("")),
  from: z.string().max(20).optional().or(z.literal("")),
  to: z.string().max(20).optional().or(z.literal("")),
  lastCTC: z.string().max(40).optional().or(z.literal("")),
  reasonForLeaving: opt(300),
});
const emergencyContactRow = z.object({
  name: z.string().max(100).optional().or(z.literal("")),
  relation: z.string().max(60).optional().or(z.literal("")),
  address: z.string().max(300).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(80).optional().or(z.literal("")),
  country: z.string().max(80).optional().or(z.literal("")),
  phoneNumber: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
});

export const completeProfileSchema = z.object({
  // Personal
  title: z.enum(["mr", "mrs", "ms", "dr"], { errorMap: () => ({ message: "Title is required" }) }),
  name: req("Name is required", 100),
  gender: z.enum(["male", "female", "other"], { errorMap: () => ({ message: "Gender is required" }) }),
  email: z.string().email("Valid email is required"),
  // Optional — a personal email isn't every employee's to give, and the
  // onboarding UI never marks this field as required.
  personalEmail: z.string().email("Enter a valid personal email").optional().or(z.literal("")),
  mobileNumber: req("Mobile number is required", 30),
  alternatePhone: opt(30),
  dob: z.coerce.date({ errorMap: () => ({ message: "Date of birth is required" }) }),
  placeOfBirth: opt(120),
  bloodGroup: req("Blood group is required", 8),
  nationality: req("Nationality is required", 80),
  maritalStatus: z.enum(["married", "unmarried"], { errorMap: () => ({ message: "Marital status is required" }) }),
  fatherOrSpouseName: opt(120),
  religion: opt(60),
  aadhaarNumber: opt(20),
  panNumber: opt(20),
  oldCompanyExperience: req("Previous experience is required", 1000),
  // Structured rows, alongside the required free-text summary above — a
  // fresher with nothing to list here still completes the wizard, since
  // nothing in this array is itself required.
  previousExperience: z.array(previousExperienceRow).max(5).optional(),
  // Bank
  bank: z.object({
    bankAccountNumber: req("Account number is required", 40),
    ibanIfsc: req("IBAN / IFSC is required", 40),
    bankName: req("Bank name is required", 120),
    nameInBank: req("Name in bank is required", 120),
    branchName: opt(160),
    accountType: z.enum(["savings", "current"]).optional(),
  }),
  // Education — at least one row, up to five, matching the joining form.
  // The array's own .min(1) only checks that a row exists, not that it says
  // anything — the first row's core fields are enforced separately below,
  // the same way the primary emergency contact is.
  education: z
    .array(educationRow)
    .min(1, "At least one education entry is required")
    .max(5)
    .superRefine((rows, ctx) => {
      const first = rows[0];
      if (!first?.qualification) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Qualification is required", path: [0, "qualification"] });
      if (!first?.from) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "From is required", path: [0, "from"] });
      if (!first?.to) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "To is required", path: [0, "to"] });
      if (!first?.institute) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Institute is required", path: [0, "institute"] });
    }),
  // Addresses
  currentAddress: z.object({
    address: req("Address is required", 300),
    city: req("City is required", 80),
    state: req("State is required", 80),
    country: req("Country is required", 80),
    pin: opt(20),
  }),
  permanentAddress: z.object({
    address: req("Address is required", 300),
    city: req("City is required", 80),
    state: req("State is required", 80),
    country: req("Country is required", 80),
    pin: opt(20),
  }),
  // Emergency contacts — primary required, a secondary is optional.
  emergencyContacts: z
    .array(emergencyContactRow)
    .min(1, "At least one emergency contact is required")
    .max(2)
    .superRefine((rows, ctx) => {
      const primary = rows[0];
      if (!primary?.name) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Name is required", path: [0, "name"] });
      if (!primary?.relation) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Relation is required", path: [0, "relation"] });
      if (!primary?.phoneNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Phone number is required", path: [0, "phoneNumber"] });
    }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
