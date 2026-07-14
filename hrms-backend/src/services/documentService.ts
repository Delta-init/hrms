import { Employee } from "../models/Employee.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import {
  putObject,
  deleteObject,
  documentKey,
  publicUrl,
} from "./uploadService.js";
import {
  DOCUMENT_REQUIREMENTS,
  PHOTO_TYPES,
} from "../config/documentRequirements.js";
import type { DocumentType, IEmployee } from "../types/index.js";

const DOC_TYPES: DocumentType[] = [
  "passport",
  "visa_copy",
  "aadhaar",
  "photo",
  "education_certificate",
  "experience_certificate",
];

class DocError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function myEmployee(userId: string): Promise<IEmployee> {
  const employee = await Employee.findOne(scoped({ user: userId }));
  if (!employee) {
    throw new DocError(
      "No employee is linked to your account. Please contact your administrator.",
      400
    );
  }
  return employee;
}

function serializeDocs(employee: IEmployee) {
  return (employee.documents ?? []).map((d) => ({
    type: d.type,
    fileName: d.fileName,
    mimeType: d.mimeType,
    size: d.size,
    uploadedAt: d.uploadedAt,
    url: publicUrl(d.fileKey),
  }));
}

/** The caller's documents + the requirement matrix for their location. */
export async function listMyDocuments(userId: string) {
  const employee = await myEmployee(userId);
  const location = employee.location ?? null;
  return {
    location,
    requirements: location ? DOCUMENT_REQUIREMENTS[location] : [],
    documents: serializeDocs(employee),
    photo: employee.photo ? publicUrl(employee.photo) : "",
  };
}

/** Upload (or replace) one document of a given type on the caller's employee. */
export async function uploadMyDocument(
  userId: string,
  type: string,
  file: Express.Multer.File
) {
  if (!DOC_TYPES.includes(type as DocumentType)) {
    throw new DocError(`Unknown document type: ${type}`);
  }
  const docType = type as DocumentType;
  const employee = await myEmployee(userId);

  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  const key = documentKey(
    getOrgId(),
    String(employee._id),
    docType,
    ext,
    Date.now()
  );
  await putObject(key, file.buffer, file.mimetype);

  // Replace any existing document of the same type (and clean up its object).
  const existing = (employee.documents ?? []).find((d) => d.type === docType);
  if (existing?.fileKey) await deleteObject(existing.fileKey);
  employee.documents = (employee.documents ?? []).filter(
    (d) => d.type !== docType
  );
  employee.documents.push({
    type: docType,
    fileName: file.originalname,
    fileKey: key,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  });

  // The photo doubles as the profile/portal photo.
  if (PHOTO_TYPES.includes(docType)) employee.photo = key;

  await employee.save();
  return listMyDocuments(userId);
}

/** Remove a document of a given type. */
export async function deleteMyDocument(userId: string, type: string) {
  const employee = await myEmployee(userId);
  const doc = (employee.documents ?? []).find((d) => d.type === type);
  if (doc?.fileKey) await deleteObject(doc.fileKey);
  employee.documents = (employee.documents ?? []).filter(
    (d) => d.type !== type
  );
  if (PHOTO_TYPES.includes(type as DocumentType)) employee.photo = "";
  await employee.save();
  return listMyDocuments(userId);
}
