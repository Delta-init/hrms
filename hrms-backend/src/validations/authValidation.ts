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
export const completeProfileSchema = z.object({
  // Personal
  title: z.enum(["mr", "mrs", "ms", "dr"], { errorMap: () => ({ message: "Title is required" }) }),
  name: req("Name is required", 100),
  gender: z.enum(["male", "female", "other"], { errorMap: () => ({ message: "Gender is required" }) }),
  email: z.string().email("Valid email is required"),
  // Optional, like the equivalent field in employeeValidation.ts — a personal
  // email isn't every employee's to give, and the onboarding UI never marks
  // this field as required.
  personalEmail: z.string().email("Enter a valid personal email").optional().or(z.literal("")),
  mobileNumber: req("Mobile number is required", 30),
  dob: z.coerce.date({ errorMap: () => ({ message: "Date of birth is required" }) }),
  bloodGroup: req("Blood group is required", 8),
  nationality: req("Nationality is required", 80),
  maritalStatus: z.enum(["married", "unmarried"], { errorMap: () => ({ message: "Marital status is required" }) }),
  oldCompanyExperience: req("Previous experience is required", 1000),
  // Bank
  bank: z.object({
    bankAccountNumber: req("Account number is required", 40),
    ibanIfsc: req("IBAN / IFSC is required", 40),
    bankName: req("Bank name is required", 120),
    nameInBank: req("Name in bank is required", 120),
  }),
  // Education (single mandatory entry)
  education: z.object({
    qualification: req("Qualification is required", 120),
    from: req("From is required", 20),
    to: req("To is required", 20),
    institute: req("Institute is required", 160),
  }),
  // Addresses
  currentAddress: z.object({
    address: req("Address is required", 300),
    city: req("City is required", 80),
    state: req("State is required", 80),
    country: req("Country is required", 80),
  }),
  permanentAddress: z.object({
    address: req("Address is required", 300),
    city: req("City is required", 80),
    state: req("State is required", 80),
    country: req("Country is required", 80),
  }),
  // Emergency contact (single mandatory entry)
  emergencyContact: z.object({
    name: req("Name is required", 100),
    relation: req("Relation is required", 60),
    address: req("Address is required", 300),
    city: req("City is required", 80),
    state: req("State is required", 80),
    country: req("Country is required", 80),
    phoneNumber: req("Phone number is required", 30),
    email: z.string().email("Valid email is required"),
  }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
