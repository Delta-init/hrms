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
