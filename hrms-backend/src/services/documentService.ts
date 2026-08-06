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
