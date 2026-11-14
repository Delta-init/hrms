import { dayOf } from "./visaGate.js";

/**
 * The documents on an employee's record that run out, one entry each.
 *
 * The visa counts only for someone it applies to — based in Dubai and not
 * marked "visa not needed" — the same rule as the visa popup, so the two never
 * disagree about whose visa matters. Every other dated document counts for
 * anybody who has one: a passport expires in Bangalore too.
 *
 * `slot` is how the Documents page names the same thing, so a document HR has
 * muted there ("ignored") is skipped here as well.
 */

export interface ExpiringDoc {
  /** Stable name for the reminder log: "visa", "passport", "other:<id>"… */
  doc: string;
  label: string;
  /** The Documents page's name for it, to match what HR has muted. */
  slot: string;
  expiryDay: string;
  /** The visa has its own submissions and statuses; everything else is renewed through HR. */
  isVisa: boolean;
}

interface EmployeeDocsInput {
  location?: string | null;
  visaNotRequired?: boolean;
  visa?: { expiryDate?: Date | null } | null;
  passport?: { expiryDate?: Date | null } | null;
  emiratesId?: { expiryDate?: Date | null } | null;
  labourCard?: { expiryDate?: Date | null } | null;
  otherDocuments?: { _id?: unknown; label?: string; expiryDate?: Date | null }[] | null;
}

export function expiringDocs(e: EmployeeDocsInput): ExpiringDoc[] {
  const out: ExpiringDoc[] = [];
  const add = (doc: string, label: string, slot: string, date: Date | null | undefined, isVisa = false) => {
    const expiryDay = dayOf(date ?? null);
    if (expiryDay) out.push({ doc, label, slot, expiryDay, isVisa });
  };
  if (e.location === "dubai" && !e.visaNotRequired) add("visa", "Visa", "visa_copy", e.visa?.expiryDate, true);
  // India's identity slot is satisfied by a passport, so muting either mutes it.
  add("passport", "Passport", e.location === "india" ? "identity" : "passport", e.passport?.expiryDate);
  add("emiratesId", "Emirates ID", "emirates_id", e.emiratesId?.expiryDate);
  add("labourCard", "Labour card", "labour_card", e.labourCard?.expiryDate);
  for (const o of e.otherDocuments ?? []) {
    if (!o._id) continue;
    add(`other:${String(o._id)}`, o.label?.trim() || "Document", `other:${String(o._id)}`, o.expiryDate);
  }
  return out;
}
