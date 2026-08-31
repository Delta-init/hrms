import { CompanyDocument } from "../models/CompanyDocument.js";
import { orgFilter, getOrgId, scoped } from "../utils/orgContext.js";
import { publicUrl } from "../config/r2.js";
import { putObject, deleteObject, attachmentKey } from "./uploadService.js";
import { DEFAULT_EXPIRY_WINDOW_DAYS, type DocumentStatus } from "./documentOverviewService.js";

/**
 * Documents the business itself has to keep current.
 *
 * Deliberately its own collection rather than a slot on the employee overview:
 * those rows are generated from the requirement matrix, one per person per
 * requirement, and a trade licence belongs to nobody. Sharing the status
 * vocabulary is enough to make the two read alike without pretending a company
 * is an employee.
 */

const DAY = 86_400_000;

export interface CompanyDocumentInput {
  companyName?: string;
  documentType?: string;
  number?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  notes?: string;
}

class DocError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Dates arrive as strings from a multipart form; blank means "not set". */
function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days from today, negative once past. Null when there is no date. */
function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY);
}

/**
 * The same vocabulary the employee documents use, minus the ones that cannot
 * apply: nothing here is "missing", because a company document only exists
 * once somebody has added it.
 */
function statusOf(days: number | null, within: number): DocumentStatus {
  if (days === null) return "valid";
  if (days < 0) return "expired";
  if (days <= within) return "expiring";
  return "valid";
}

/** Slugged the way asset categories are, so filters group rather than fragment. */
export const typeSlug = (v: string) =>
  v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";

type Row = Record<string, unknown>;

interface ShapedRow extends Row {
  fileUrl: string;
  daysToExpiry: number | null;
  status: DocumentStatus;
}

function shape(doc: Row, within: number): ShapedRow {
  const expiryDate = (doc.expiryDate as Date | null) ?? null;
  const days = daysUntil(expiryDate);
  return {
    ...doc,
    fileUrl: doc.fileKey ? publicUrl(String(doc.fileKey)) : "",
    daysToExpiry: days,
    status: statusOf(days, within),
  };
}

export interface CompanyDocumentQuery {
  company?: string;
  documentType?: string;
  status?: string;
  search?: string;
  within?: string;
}

export async function listCompanyDocuments(query: CompanyDocumentQuery = {}) {
  const within = Math.max(0, Number(query.within) || DEFAULT_EXPIRY_WINDOW_DAYS);

  const filter: Record<string, unknown> = { ...orgFilter() };
  if (query.company) filter.companyName = query.company;
  if (query.documentType) filter.documentType = query.documentType;

  const docs = await CompanyDocument.find(filter).sort({ expiryDate: 1, companyName: 1 }).lean();
  let rows = docs.map((d) => shape(d as Row, within));

  // Counted before the status and search filters, so the chips keep showing the
  // size of each bucket rather than only what is currently on screen.
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  if (query.status) rows = rows.filter((r) => r.status === query.status);
  if (query.search) {
    const term = query.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      `${r.companyName} ${r.documentType} ${r.number} ${r.notes}`.toLowerCase().includes(term)
    );
  }

  // Expiring soonest first; anything without a date sits at the bottom rather
  // than at the top, where a null would sort if left to Mongo.
  rows.sort((a, b) => (a.daysToExpiry ?? Infinity) - (b.daysToExpiry ?? Infinity));

  const companies = [...new Set(docs.map((d) => String(d.companyName)))].sort();
  const types = [...new Set(docs.map((d) => String(d.documentType)))].sort();

  return { rows, counts, total: docs.length, within, companies, types };
}

/** Store the attachment, replacing whatever was there before. */
async function attach(doc: { fileKey?: string }, file: Express.Multer.File, userId: string) {
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  const key = attachmentKey(getOrgId(), userId, "company-documents", ext, Date.now());
  await putObject(key, file.buffer, file.mimetype);
  const previous = doc.fileKey;
  const next = {
    fileKey: key,
    fileName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  };
  // Only after the new object is safely stored — a failed upload must not lose
  // the file that was already there.
  if (previous) await deleteObject(previous);
  return next;
}

export async function createCompanyDocument(
  input: CompanyDocumentInput,
  userId: string,
  file?: Express.Multer.File
) {
  const companyName = (input.companyName ?? "").trim();
  const documentType = (input.documentType ?? "").trim();
  if (!companyName) throw new DocError("The company name is required");
  if (!documentType) throw new DocError("The document type is required");

  const doc = new CompanyDocument({
    organization: getOrgId(),
    companyName,
    documentType: typeSlug(documentType),
    number: input.number?.trim() ?? "",
    issueDate: toDate(input.issueDate),
    expiryDate: toDate(input.expiryDate),
    notes: input.notes?.trim() ?? "",
    createdBy: userId,
  });
  if (file) Object.assign(doc, await attach(doc, file, userId));
  await doc.save();
  return shape(doc.toObject() as Row, DEFAULT_EXPIRY_WINDOW_DAYS);
}

export async function updateCompanyDocument(
  id: string,
  input: CompanyDocumentInput,
  userId: string,
  file?: Express.Multer.File
) {
  const doc = await CompanyDocument.findOne(scoped({ _id: id }));
  if (!doc) throw new DocError("That document could not be found", 404);

  if (input.companyName !== undefined) {
    const name = input.companyName.trim();
    if (!name) throw new DocError("The company name is required");
    doc.companyName = name;
  }
  if (input.documentType !== undefined) {
    const type = input.documentType.trim();
    if (!type) throw new DocError("The document type is required");
    doc.documentType = typeSlug(type);
  }
  // Sent-but-blank clears the field; absent leaves it alone.
  if (input.number !== undefined) doc.number = input.number.trim();
  if (input.notes !== undefined) doc.notes = input.notes.trim();
  if (input.issueDate !== undefined) doc.issueDate = toDate(input.issueDate);
  if (input.expiryDate !== undefined) doc.expiryDate = toDate(input.expiryDate);
  if (file) Object.assign(doc, await attach(doc, file, userId));

  await doc.save();
  return shape(doc.toObject() as Row, DEFAULT_EXPIRY_WINDOW_DAYS);
}

export async function deleteCompanyDocument(id: string) {
  const doc = await CompanyDocument.findOne(scoped({ _id: id }));
  if (!doc) throw new DocError("That document could not be found", 404);
  if (doc.fileKey) await deleteObject(doc.fileKey);
  await CompanyDocument.deleteOne({ _id: doc._id });
  return { _id: String(doc._id) };
}
