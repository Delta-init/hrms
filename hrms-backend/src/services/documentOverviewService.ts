import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { DocumentIgnore } from "../models/DocumentIgnore.js";
import { orgFilter, getOrgId } from "../utils/orgContext.js";
import { publicUrl } from "./uploadService.js";
import {
  DOCUMENT_REQUIREMENTS,
  SLOT_DETAIL_FIELD,
  detailNumber,
} from "../config/documentRequirements.js";
import type { EmployeeLocation } from "../types/index.js";

/**
 * Every document the organization is meant to hold, present or not.
 *
 * Two things made this hard to see before. Documents live in three places — the
 * uploaded file, the number-and-dates field beside it, and the free-form list —
 * and only the last of those held both a file and an expiry. And a document
 * nobody has uploaded has no record at all, so the gaps were invisible by
 * construction: you could only find them by opening thirty-four employees in
 * turn and noticing what was not there.
 *
 * So rows are generated from the requirement matrix rather than read from
 * storage. Every slot that applies to somebody produces a row whether or not a
 * file exists, and the file, the number and the expiry are joined back onto it.
 * The missing ones are the point.
 */

export type DocumentStatus = "missing" | "expired" | "expiring" | "valid" | "not_uploaded" | "ignored";

/**
 * How far ahead counts as "expiring".
 *
 * Two months. Ninety days put documents into the amber bucket a full quarter
 * before anybody could act on them, so the bucket stayed permanently full and
 * stopped meaning anything. Sixty days is close enough that appearing in it is
 * a reason to start the renewal.
 */
export const DEFAULT_EXPIRY_WINDOW_DAYS = 60;

export interface DocumentRow {
  employee: {
    _id: unknown;
    name: string;
    employeeCode?: string;
    designation?: string;
    department: string | null;
    location: EmployeeLocation | null;
  };
  /** Requirement key, or `other:<id>` for a free-form entry. */
  slot: string;
  label: string;
  required: boolean;
  number: string;
  issueDate: Date | null;
  expiryDate: Date | null;
  /** Negative once expired. Null when the document has no expiry to track. */
  daysToExpiry: number | null;
  file: { fileName: string; url: string; uploadedAt: Date | null; mimeType?: string; size?: number } | null;
  status: DocumentStatus;
  /** Set when somebody has decided this one is not worth chasing. */
  ignored: { reason: string; at: Date | null } | null;
  /** What the status would be if it were not ignored — so the chip can say so. */
  underlyingStatus: DocumentStatus;
}

export interface DocumentQuery {
  status?: string;
  slot?: string;
  location?: string;
  department?: string;
  employee?: string;
  /** Expiry horizon in days for the "expiring" bucket. */
  within?: string;
  search?: string;
}

/** One row, addressed the way the client sees it. */
export interface DocumentRef {
  employee: string;
  slot: string;
}

const DAY = 86_400_000;

/** The shape the passport/visa/Emirates ID/labour card fields have in common. */
type DocDetail = {
  issueDate?: Date | null;
  expiryDate?: Date | null;
  passportNumber?: string;
  cardNumber?: string;
  idNumber?: string;
  type?: string;
};

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
 * What state a slot is in.
 *
 * Expiry beats absence deliberately: a passport that expired last month is a
 * worse problem than one nobody scanned, and if both are true the expiry is the
 * one somebody has to act on.
 */
function statusOf(hasFile: boolean, required: boolean, days: number | null, within: number): DocumentStatus {
  if (days !== null && days < 0) return "expired";
  if (days !== null && days <= within) return "expiring";
  if (!hasFile) return required ? "missing" : "not_uploaded";
  return "valid";
}

export async function documentsOverview(query: DocumentQuery) {
  const within = Math.max(0, Number(query.within) || DEFAULT_EXPIRY_WINDOW_DAYS);

  const filter: Record<string, unknown> = { ...orgFilter(), status: { $ne: "terminated" } };
  if (query.employee) filter._id = query.employee;
  if (query.location) filter.location = query.location;
  if (query.department) filter.department = query.department;

  const [employees, ignores] = await Promise.all([
    Employee.find(filter)
      .select("name employeeCode designation department location documents otherDocuments passport visa emiratesId labourCard")
      .populate<{ department: { name: string } | null }>("department", "name")
      .sort({ name: 1 })
      .lean(),
    DocumentIgnore.find(orgFilter()).lean(),
  ]);

  const ignored = new Map(ignores.map((i) => [`${String(i.employee)}:${i.slot}`, i]));
  const rows: DocumentRow[] = [];

  /**
   * An ignored row keeps its real status underneath and reports "ignored" on
   * top. Overwriting the real one would make un-ignoring guess at what the row
   * had been, and the reviewer could not see what they were reinstating.
   */
  const withIgnore = (row: Omit<DocumentRow, "ignored" | "underlyingStatus">): DocumentRow => {
    const hit = ignored.get(`${String(row.employee._id)}:${row.slot}`);
    return {
      ...row,
      underlyingStatus: row.status,
      status: hit ? "ignored" : row.status,
      ignored: hit ? { reason: hit.reason ?? "", at: hit.ignoredAt ?? null } : null,
    };
  };

  for (const emp of employees) {
    const who = {
      _id: emp._id,
      name: emp.name,
      employeeCode: emp.employeeCode,
      designation: emp.designation,
      department: (emp.department as { name?: string } | null)?.name ?? null,
      location: (emp.location as EmployeeLocation) ?? null,
    };
    const files = emp.documents ?? [];

    // A location decides which slots apply. Without one we cannot say what is
    // required, so nothing is invented — the employee simply has no slot rows.
    for (const req of who.location ? DOCUMENT_REQUIREMENTS[who.location] : []) {
      const file = files.find((d) => req.accepts.includes(d.type));
      const detailField = SLOT_DETAIL_FIELD[req.key];
      // The four detail fields differ only in what they call their number, which
      // detailNumber() smooths over; the dates are common to all of them.
      const detail = detailField ? ((emp as unknown as Record<string, DocDetail | null>)[detailField] ?? null) : null;
      const expiryDate = detail?.expiryDate ?? null;
      const days = daysUntil(expiryDate);

      rows.push(withIgnore({
        employee: who,
        slot: req.key,
        label: req.label,
        required: req.required,
        number: detailNumber(detail),
        issueDate: detail?.issueDate ?? null,
        expiryDate,
        daysToExpiry: days,
        file: file
          ? {
              fileName: file.fileName ?? req.label,
              url: publicUrl(file.fileKey),
              uploadedAt: file.uploadedAt ?? null,
              mimeType: file.mimeType,
              size: file.size,
            }
          : null,
        status: statusOf(!!file, req.required, days, within),
      }));
    }

    // Free-form entries are already whole — label, number, dates and file in one
    // place — so they only need shaping, not joining.
    for (const other of emp.otherDocuments ?? []) {
      const days = daysUntil(other.expiryDate);
      rows.push(withIgnore({
        employee: who,
        slot: `other:${String(other._id)}`,
        label: other.label,
        required: false,
        number: other.number ?? "",
        issueDate: other.issueDate ?? null,
        expiryDate: other.expiryDate ?? null,
        daysToExpiry: days,
        file: other.fileKey
          ? {
              fileName: other.fileName ?? other.label,
              url: publicUrl(other.fileKey),
              uploadedAt: null,
              mimeType: other.mimeType,
              size: other.size,
            }
          : null,
        status: statusOf(!!other.fileKey, false, days, within),
      }));
    }
  }

  // Counted before the status and search filters, so the chips keep showing the
  // size of each bucket rather than only what is currently on screen.
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  let visible = rows;
  if (query.status) visible = visible.filter((r) => r.status === query.status);
  if (query.slot) visible = visible.filter((r) => r.slot === query.slot || r.slot.startsWith(`${query.slot}:`));
  if (query.search) {
    const term = query.search.trim().toLowerCase();
    visible = visible.filter((r) =>
      `${r.employee.name} ${r.employee.employeeCode ?? ""} ${r.label} ${r.number}`.toLowerCase().includes(term)
    );
  }

  // Worst first: expired, then soonest to expire, then gaps, then the rest.
  // Ignored sits last — it is the bucket somebody has already dealt with.
  const rank: Record<DocumentStatus, number> = { expired: 0, expiring: 1, missing: 2, not_uploaded: 3, valid: 4, ignored: 5 };
  visible.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.daysToExpiry ?? Infinity) - (b.daysToExpiry ?? Infinity) ||
      a.employee.name.localeCompare(b.employee.name)
  );

  return { rows: visible, counts, total: rows.length, within, employees: employees.length };
}

/**
 * Stop counting these rows as a problem.
 *
 * Upserted rather than inserted so re-ignoring something updates the reason
 * instead of failing on the unique index — the caller is selecting rows from a
 * table and cannot be expected to know which of them are already dismissed.
 */
export async function ignoreDocuments(refs: DocumentRef[], userId: string, reason = "") {
  const orgId = getOrgId();
  if (!refs.length) return { ignored: 0 };
  const oid = (v: string) => new Types.ObjectId(v);
  const result = await DocumentIgnore.bulkWrite(
    refs.map(({ employee, slot }) => ({
      updateOne: {
        filter: { organization: oid(String(orgId)), employee: oid(employee), slot },
        update: {
          $set: { reason: reason.trim().slice(0, 200), ignoredBy: oid(userId), ignoredAt: new Date() },
        },
        upsert: true,
      },
    }))
  );
  return { ignored: result.upsertedCount + result.modifiedCount };
}

/** Put them back in the counts. */
export async function unignoreDocuments(refs: DocumentRef[]) {
  if (!refs.length) return { restored: 0 };
  const result = await DocumentIgnore.deleteMany({
    ...orgFilter(),
    $or: refs.map(({ employee, slot }) => ({ employee, slot })),
  });
  return { restored: result.deletedCount };
}

/**
 * Every ignored (employee, slot) pair in the org, as a lookup set.
 *
 * The dashboard counts expiries from the employee documents directly rather
 * than through the rows above, so it needs the same dismissals applied or the
 * two views disagree about how many problems exist.
 */
export async function ignoredSlots(orgId?: string | null): Promise<Set<string>> {
  const scope = orgId ? { organization: orgId } : orgFilter();
  const rows = await DocumentIgnore.find(scope).select("employee slot").lean();
  return new Set(rows.map((r) => `${String(r.employee)}:${r.slot}`));
}
