import { z } from "zod";

const req = (msg = "Required") => z.string().min(1, msg);
const address = z.object({
  address: req("Address is required"),
  city: req("City is required"),
  state: req("State is required"),
  country: req("Country is required"),
});

export const onboardingSchema = z.object({
  // Personal
  title: z.enum(["mr", "mrs", "ms", "dr"], { errorMap: () => ({ message: "Select a title" }) }),
  name: req("Name is required"),
  gender: z.enum(["male", "female", "other"], { errorMap: () => ({ message: "Select a gender" }) }),
  email: z.string().email("Enter a valid email"),
  // Optional — not every employee has a personal email to give, and the form
  // never marks this field as required.
  personalEmail: z.string().email("Enter a valid personal email").optional().or(z.literal("")),
  mobileNumber: req("Mobile number is required"),
  dob: req("Date of birth is required"),
  bloodGroup: req("Blood group is required"),
  nationality: req("Nationality is required"),
  maritalStatus: z.enum(["married", "unmarried"], { errorMap: () => ({ message: "Select marital status" }) }),
  oldCompanyExperience: req("Previous experience is required"),
  // Bank
  bank: z.object({
    bankAccountNumber: req("Account number is required"),
    ibanIfsc: req("IBAN / IFSC is required"),
    bankName: req("Bank name is required"),
    nameInBank: req("Name in bank is required"),
  }),
  // Education
  education: z.object({
    qualification: req("Qualification is required"),
    from: req("From is required"),
    to: req("To is required"),
    institute: req("Institute is required"),
  }),
  // Addresses
  currentAddress: address,
  permanentAddress: address,
  // Emergency
  emergencyContact: z.object({
    name: req("Name is required"),
    relation: req("Relation is required"),
    address: req("Address is required"),
    city: req("City is required"),
    state: req("State is required"),
    country: req("Country is required"),
    phoneNumber: req("Phone number is required"),
    email: z.string().email("Enter a valid email"),
  }),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;

/** Field paths per wizard step — used to validate one step at a time. */
export const STEP_FIELDS: Record<number, (keyof OnboardingValues | string)[]> = {
  0: ["title", "name", "gender", "email", "personalEmail", "mobileNumber", "dob", "bloodGroup", "nationality", "maritalStatus", "oldCompanyExperience"],
  1: ["bank.bankAccountNumber", "bank.ibanIfsc", "bank.bankName", "bank.nameInBank"],
  2: ["education.qualification", "education.from", "education.to", "education.institute"],
  3: ["currentAddress.address", "currentAddress.city", "currentAddress.state", "currentAddress.country"],
  4: ["permanentAddress.address", "permanentAddress.city", "permanentAddress.state", "permanentAddress.country"],
  5: ["emergencyContact.name", "emergencyContact.relation", "emergencyContact.phoneNumber", "emergencyContact.email", "emergencyContact.address", "emergencyContact.city", "emergencyContact.state", "emergencyContact.country"],
};
