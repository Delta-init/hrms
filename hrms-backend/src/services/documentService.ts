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

/**
 * The employee an administrator is filing documents for.
 *
 * Scoped like every other lookup, so an id from another tenant reads as "not
 * found" rather than exposing whether it exists.
 */
async function employeeById(employeeId: string): Promise<IEmployee> {
  const employee = await Employee.findOne(scoped({ _id: employeeId }));
  if (!employee) throw new DocError("Employee not found", 404);
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

/** An employee's documents + the requirement matrix for their location. */
function documentsFor(employee: IEmployee) {
  const location = employee.location ?? null;
  return {
    location,
    requirements: location ? DOCUMENT_REQUIREMENTS[location] : [],
    documents: serializeDocs(employee),
    photo: employee.photo ? publicUrl(employee.photo) : "",
  };
}

/** Store (or replace) one document of a given type on an employee. */
async function putDocument(employee: IEmployee, type: string, file: Express.Multer.File) {
  if (!DOC_TYPES.includes(type as DocumentType)) {
    throw new DocError(`Unknown document type: ${type}`);
  }
  const docType = type as DocumentType;

  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  const key = documentKey(getOrgId(), String(employee._id), docType, ext, Date.now());
  await putObject(key, file.buffer, file.mimetype);

  // Replace any existing document of the same type (and clean up its object).
  const existing = (employee.documents ?? []).find((d) => d.type === docType);
  if (existing?.fileKey) await deleteObject(existing.fileKey);
  employee.documents = (employee.documents ?? []).filter((d) => d.type !== docType);
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
  return documentsFor(employee);
}

/** Drop one document of a given type from an employee. */
async function dropDocument(employee: IEmployee, type: string) {
  const doc = (employee.documents ?? []).find((d) => d.type === type);
  if (doc?.fileKey) await deleteObject(doc.fileKey);
  employee.documents = (employee.documents ?? []).filter((d) => d.type !== type);
  if (PHOTO_TYPES.includes(type as DocumentType)) employee.photo = "";
  await employee.save();
  return documentsFor(employee);
}

/** The caller's own documents. */
export async function listMyDocuments(userId: string) {
  return documentsFor(await myEmployee(userId));
}

/** Upload (or replace) one document of a given type on the caller's employee. */
export async function uploadMyDocument(userId: string, type: string, file: Express.Multer.File) {
  return putDocument(await myEmployee(userId), type, file);
}

/** Remove a document of a given type from the caller's employee. */
export async function deleteMyDocument(userId: string, type: string) {
  return dropDocument(await myEmployee(userId), type);
}

/*
 * Administrator side — the same three operations against an employee chosen by
 * id. HR files passports and certificates on people's behalf all the time, and
 * until now the only upload path resolved the employee from the caller's own
 * login, so there was no way to do it for anyone else.
 */

/** One employee's documents, for an administrator. */
export async function listEmployeeDocuments(employeeId: string) {
  return documentsFor(await employeeById(employeeId));
}

/** Upload (or replace) a document on another employee's record. */
export async function uploadEmployeeDocument(employeeId: string, type: string, file: Express.Multer.File) {
  return putDocument(await employeeById(employeeId), type, file);
}

/** Remove a document from another employee's record. */
export async function deleteEmployeeDocument(employeeId: string, type: string) {
  return dropDocument(await employeeById(employeeId), type);
}

/*
 * Free-form documents and credentials — anything the fixed passport/visa/
 * labour-card/Emirates-ID fields don't cover. One list serves both the file
 * side and the expiry side, so a residence permit is filed once and shows up
 * both as a scan and in the renewal reminders.
 */

export interface OtherDocumentInput {
  label: string;
  number?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  notes?: string;
}

/** Dates arrive as strings from a multipart form; blank means "not set". */
function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function serializeOther(employee: IEmployee) {
  return (employee.otherDocuments ?? []).map((d) => {
    // Spreading a subdocument yields Mongoose internals, not the fields.
    const plain =
      (d as { toObject?: () => Record<string, unknown> }).toObject?.() ?? (d as unknown as Record<string, unknown>);
    return { ...plain, fileUrl: plain.fileKey ? publicUrl(String(plain.fileKey)) : "" };
  });
}

/** Store an attachment for a custom record, replacing any previous one. */
async function attachFile(
  employee: IEmployee,
  entry: { fileKey?: string; fileName?: string; mimeType?: string; size?: number; uploadedAt?: Date | null },
  file: Express.Multer.File
) {
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  const key = documentKey(getOrgId(), String(employee._id), "other", ext, Date.now());
  await putObject(key, file.buffer, file.mimetype);
  if (entry.fileKey) await deleteObject(entry.fileKey);
  entry.fileKey = key;
  entry.fileName = file.originalname;
  entry.mimeType = file.mimetype;
  entry.size = file.size;
  entry.uploadedAt = new Date();
}

export async function listOtherDocuments(employeeId: string) {
  return serializeOther(await employeeById(employeeId));
}

export async function addOtherDocument(
  employeeId: string,
  input: OtherDocumentInput,
  file?: Express.Multer.File
) {
  const label = (input.label ?? "").trim();
  if (!label) throw new DocError("A name for this document is required");

  const employee = await employeeById(employeeId);
  const entry: Record<string, unknown> = {
    label,
    number: input.number?.trim() || undefined,
    issueDate: toDate(input.issueDate),
    expiryDate: toDate(input.expiryDate),
    notes: input.notes?.trim() || undefined,
  };
  if (file) await attachFile(employee, entry as never, file);

  employee.otherDocuments = [...(employee.otherDocuments ?? []), entry as never];
  await employee.save();
  return serializeOther(employee);
}

export async function updateOtherDocument(
  employeeId: string,
  recordId: string,
  input: Partial<OtherDocumentInput>,
  file?: Express.Multer.File
) {
  const employee = await employeeById(employeeId);
  const entry = (employee.otherDocuments ?? []).find((d) => String(d._id) === String(recordId));
  if (!entry) throw new DocError("That document could not be found on this employee", 404);

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new DocError("A name for this document is required");
    entry.label = label;
  }
  // Sent-but-blank clears the field; absent leaves it alone.
  if (input.number !== undefined) entry.number = input.number.trim() || undefined;
  if (input.notes !== undefined) entry.notes = input.notes.trim() || undefined;
  if (input.issueDate !== undefined) entry.issueDate = toDate(input.issueDate);
  if (input.expiryDate !== undefined) entry.expiryDate = toDate(input.expiryDate);
  if (file) await attachFile(employee, entry, file);

  await employee.save();
  return serializeOther(employee);
}

export async function deleteOtherDocument(employeeId: string, recordId: string) {
  const employee = await employeeById(employeeId);
  const entry = (employee.otherDocuments ?? []).find((d) => String(d._id) === String(recordId));
  if (!entry) throw new DocError("That document could not be found on this employee", 404);

  if (entry.fileKey) await deleteObject(entry.fileKey);
  employee.otherDocuments = (employee.otherDocuments ?? []).filter(
    (d) => String(d._id) !== String(recordId)
  );
  await employee.save();
  return serializeOther(employee);
}
