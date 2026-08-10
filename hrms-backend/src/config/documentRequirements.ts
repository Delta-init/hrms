import type {
  DocumentType,
  EmployeeLocation,
  IEmployeeDocument,
} from "../types/index.js";

export interface DocRequirement {
  /** Stable slot key used by the UI and the completion check. */
  key: string;
  label: string;
  required: boolean;
  /** The photo slot also becomes the employee's profile/portal photo. */
  isPhoto?: boolean;
  /** Document types that satisfy this slot (any one of them). */
  accepts: DocumentType[];
}

/**
 * Location-driven document matrix. This is the ONE source of truth: it drives
 * both the onboarding upload UI and the backend "all required present?" guard.
 */
export const DOCUMENT_REQUIREMENTS: Record<EmployeeLocation, DocRequirement[]> = {
  dubai: [
    { key: "passport", label: "Passport", required: true, accepts: ["passport"] },
    { key: "visa_copy", label: "Visa copy", required: true, accepts: ["visa_copy"] },
    // Both are tracked for expiry on the employee record, and until now there
    // was nowhere to file the scan that goes with the number. Optional so
    // adding them does not retroactively mark 34 onboarded people incomplete.
    { key: "emirates_id", label: "Emirates ID", required: false, accepts: ["emirates_id"] },
    { key: "labour_card", label: "Labour card", required: false, accepts: ["labour_card"] },
    { key: "photo", label: "Photo", required: true, isPhoto: true, accepts: ["photo"] },
    { key: "education_certificate", label: "Educational certificate", required: true, accepts: ["education_certificate"] },
    { key: "experience_certificate", label: "Experience certificate", required: false, accepts: ["experience_certificate"] },
  ],
  india: [
    { key: "identity", label: "Aadhaar / Passport", required: true, accepts: ["aadhaar", "passport"] },
    { key: "photo", label: "Photo", required: true, isPhoto: true, accepts: ["photo"] },
    { key: "education_certificate", label: "Educational certificate", required: true, accepts: ["education_certificate"] },
    { key: "experience_certificate", label: "Experience certificate", required: false, accepts: ["experience_certificate"] },
  ],
};

/** All document types that count as a profile photo. */
export const PHOTO_TYPES: DocumentType[] = ["photo"];

/**
 * Which field on the employee holds the number and dates for a document slot.
 *
 * The scan and the expiry date have always lived apart: the file goes into
 * `documents[]`, which has no expiry, while the number and dates go into a
 * field of their own, which has no file. Nothing joined them, so a passport
 * could be on file and about to expire without either half knowing. This is
 * that join, in one place, so the documents view and the dashboard's expiry
 * warning cannot drift apart.
 *
 * Slots absent from this map — photo, certificates — simply do not expire.
 */
export const SLOT_DETAIL_FIELD: Record<string, "passport" | "visa" | "emiratesId" | "labourCard"> = {
  passport: "passport",
  visa_copy: "visa",
  emirates_id: "emiratesId",
  labour_card: "labourCard",
  // India's combined slot is satisfied by a passport, so it reads the same field.
  identity: "passport",
};

/** The number a detail field carries, whatever that field happens to call it. */
export function detailNumber(
  detail: { passportNumber?: string; cardNumber?: string; idNumber?: string; type?: string } | null | undefined
): string {
  return detail?.passportNumber || detail?.cardNumber || detail?.idNumber || detail?.type || "";
}

/** True when every required slot for the location has at least one uploaded doc. */
export function missingRequiredDocs(
  location: EmployeeLocation,
  documents: IEmployeeDocument[]
): string[] {
  const have = new Set(documents.map((d) => d.type));
  return DOCUMENT_REQUIREMENTS[location]
    .filter((r) => r.required && !r.accepts.some((t) => have.has(t)))
    .map((r) => r.label);
}
