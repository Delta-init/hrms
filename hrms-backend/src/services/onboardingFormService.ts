import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { Employee } from "../models/Employee.js";
import { OnboardingFormTemplate } from "../models/OnboardingFormTemplate.js";
import { getObjectBuffer } from "./uploadService.js";
import { extractPositionedText, findLabel, type TextHit } from "../utils/pdfText.js";
import { scoped } from "../utils/orgContext.js";
import type { DocumentType } from "../types/index.js";

/**
 * The employee's own joining form, filled from whatever the record already
 * holds rather than handed back blank for someone to re-type.
 *
 * The template is a flat PDF — no form fields, the same situation the NDA is
 * in — so this finds each printed label by its text and writes the value
 * beneath it, the technique `agreementService.ts` already uses for a
 * signature line. Coordinates come from the uploaded file itself, not a
 * table in this code, so a template re-uploaded with a redesigned layout
 * still fills in roughly the right place rather than silently drifting.
 *
 * Best-effort throughout: a label the template no longer has is simply
 * skipped rather than failing the whole document — a form with nine of
 * eleven fields filled is worth far more than none because the eleventh
 * moved.
 */

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const INK = rgb(0.08, 0.08, 0.1);

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const word of text.split(" ")) {
    if (!out.length) { out.push(word); continue; }
    const last = out[out.length - 1]!;
    if ((last + " " + word).length <= width) out[out.length - 1] = last + " " + word;
    else if (word.length <= width) out.push(word);
    else { let w = word; while (w.length > width) { out.push(w.slice(0, width)); w = w.slice(width); } out.push(w); }
  }
  return out;
}

/** Cuts at the last whole word that fits, rather than mid-word, and says so. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const fmtDate = (d?: Date | string | null) => {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

/** Vertical gap from a label's own baseline down to where its answer sits. */
const BELOW = 18;

/**
 * Finds a label's printed position on the loaded template and writes beside
 * or beneath it. Kept as one small class only so every drawing helper shares
 * the same pages/font/hits without threading all three through every call.
 */
class Stamper {
  constructor(readonly pages: PDFPage[], readonly font: PDFFont, readonly hits: TextHit[]) {}

  private draw(page: PDFPage | undefined, x: number, y: number, text: string, size = 10) {
    page?.drawText(text, { x, y, size, font: this.font, color: INK });
  }

  /** Write a value under a label. Does nothing if the label isn't on the template. */
  under(label: string, value: string | undefined | null, opts: { size?: number; maxWidth?: number; pageIndex?: number; below?: number } = {}) {
    if (!value) return;
    const hit = findLabel(this.hits, label, { pageIndex: opts.pageIndex });
    if (!hit) return;
    let y = hit.y - (opts.below ?? BELOW);
    // Conservative default — a 2-column field is roughly 240pt wide, and at
    // 10pt Helvetica that's closer to 45 characters than a flat guess would
    // suggest. Narrower fields (the 4-column header row) pass their own.
    for (const line of wrap(value, opts.maxWidth ?? 45).slice(0, 2)) {
      this.draw(this.pages[hit.pageIndex], hit.x, y, line, opts.size ?? 10);
      y -= (opts.size ?? 10) + 3;
    }
  }

  /** Write a value under whichever occurrence of a repeated label sits nearest a given row (for a second block that reuses the first's column headers, e.g. a secondary emergency contact). */
  underNearRow(label: string, nearY: number, value: string | undefined | null, size = 10) {
    if (!value) return;
    const want = label.toLowerCase();
    const hit = this.hits
      .filter((h) => h.text.toLowerCase() === want)
      .sort((a, b) => Math.abs(a.y - nearY) - Math.abs(b.y - nearY))[0];
    if (!hit) return;
    this.draw(this.pages[hit.pageIndex], hit.x, hit.y - BELOW, value, size);
  }

  /** Mark the checkbox immediately before an option's own label text. */
  check(optionLabel: string, pageIndex?: number) {
    const opt = findLabel(this.hits, optionLabel, { pageIndex });
    if (!opt) return;
    const box = this.hits.find(
      (h) => h.pageIndex === opt.pageIndex && h.text === "☐" && Math.abs(h.y - opt.y) < 2 && h.x < opt.x && opt.x - h.xEnd < 15
    );
    if (!box) return;
    this.draw(this.pages[box.pageIndex], box.x + 1, box.y + 0.5, "X", box.height * 0.85);
  }

  /** Mark the "☐ Yes" pair on a row found by its own label — for a checklist
   *  whose Yes/No pair repeats down the page and so can't be found by label
   *  text alone. The checkbox column sits at a fixed x regardless of how
   *  long the row's own label is, so this takes the first checkbox to the
   *  right of the label rather than bounding how far away it may be. */
  checkYesNear(rowLabel: string) {
    const row = findLabel(this.hits, rowLabel);
    if (!row) return;
    const onRow = this.hits.filter((h) => h.pageIndex === row.pageIndex && h.text === "☐" && Math.abs(h.y - row.y) < 4 && h.x > row.xEnd);
    const yes = onRow.sort((a, b) => a.x - b.x)[0];
    if (!yes) return;
    this.draw(this.pages[yes.pageIndex], yes.x + 1, yes.y + 0.5, "X", yes.height * 0.85);
  }

  /** Column values for one row of a table, a fixed row height below the header — for tables (education) whose empty cells carry no text of their own to search for. */
  tableRow(headerLabel: string, rowIndex: number, rowHeight: number, columns: Array<{ x: number; text?: string }>, size = 8.5) {
    const header = findLabel(this.hits, headerLabel);
    if (!header) return;
    const y = header.y - 22 - rowIndex * rowHeight;
    for (const col of columns) {
      if (col.text) this.draw(this.pages[header.pageIndex], col.x, y, truncate(col.text, 26), size);
    }
  }
}

async function loadEmployee(employeeId: string, orgId: unknown) {
  const employee = await Employee.findOne(scoped({ _id: employeeId }))
    .populate("department", "name")
    .populate("reportingTo", "name")
    .lean<{
      _id: unknown; name: string; employeeCode: string; designation?: string;
      department?: { name?: string } | null; reportingTo?: { name?: string } | null;
      location?: string; probationPeriodDays?: number; employmentType?: string; joiningDate?: Date;
      dob?: Date; placeOfBirth?: string; nationality?: string; bloodGroup?: string; gender?: string;
      fatherOrSpouseName?: string; religion?: string; personalEmail?: string; email?: string;
      mobileNumber?: string; alternatePhone?: string;
      permanentAddress?: { address?: string; city?: string; state?: string; country?: string; pin?: string };
      currentAddress?: { address?: string; city?: string; state?: string; country?: string; pin?: string };
      emergencyContacts?: Array<{ name?: string; relation?: string; phoneNumber?: string }>;
      education?: Array<{ qualification?: string; institute?: string; fieldOfStudy?: string; to?: string; grade?: string }>;
      aadhaarNumber?: string; panNumber?: string;
      passport?: { passportNumber?: string; expiryDate?: Date };
      emiratesId?: { idNumber?: string };
      visa?: { expiryDate?: Date };
      bank?: { nameInBank?: string; bankName?: string; bankAccountNumber?: string; ibanIfsc?: string; branchName?: string; accountType?: string };
      documents?: Array<{ type: DocumentType }>;
    } | null>();
  if (!employee) throw err("Employee not found", 404);
  return employee;
}

type FormEmployee = Awaited<ReturnType<typeof loadEmployee>>;

/** The fixed slots this app already tracks, matched against the form's checklist rows. */
const CHECKLIST_FROM_DOCUMENTS: Array<{ row: string; type: DocumentType }> = [
  { row: "Aadhaar Card", type: "aadhaar" },
  { row: "Passport", type: "passport" },
  { row: "Visa Copy (If Applicable)", type: "visa_copy" },
  { row: "Degree / Diploma Certificate", type: "education_certificate" },
  { row: "Previous Offer / Relieving Letter", type: "experience_certificate" },
  { row: "Passport-size Photographs (2 nos.)", type: "photo" },
];

function fillPage1(s: Stamper, e: FormEmployee) {
  // The header is a 4-column grid, each column under 100pt wide — well short
  // of a normal 2-column field, so these need their own tighter wrap width.
  const HEADER_WIDTH = 19;
  s.under("EMPLOYEE ID", e.employeeCode, { maxWidth: HEADER_WIDTH });
  s.under("DATE OF JOINING", fmtDate(e.joiningDate), { maxWidth: HEADER_WIDTH });
  s.under("DEPARTMENT", e.department?.name, { maxWidth: HEADER_WIDTH, size: 9 });
  s.under("DESIGNATION / ROLE", e.designation, { maxWidth: HEADER_WIDTH });
  s.under("REPORTING MANAGER", e.reportingTo?.name, { maxWidth: HEADER_WIDTH, size: 9 });
  s.under("WORK LOCATION", e.location === "dubai" ? "Dubai" : e.location === "india" ? "India" : undefined, { maxWidth: HEADER_WIDTH });
  s.under("PROBATION PERIOD", e.probationPeriodDays ? `${e.probationPeriodDays} days` : undefined, { maxWidth: HEADER_WIDTH });
  if (e.employmentType === "full_time") s.check("Full-Time");
  else if (e.employmentType === "part_time") s.check("Part-Time");
  else if (e.employmentType === "contract") s.check("Contract");

  s.under("FULL NAME (AS PER GOVERNMENT ID)", e.name, { maxWidth: 90 });
  s.under("DATE OF BIRTH", fmtDate(e.dob));
  s.under("PLACE OF BIRTH", e.placeOfBirth);
  s.under("NATIONALITY", e.nationality);
  s.under("BLOOD GROUP", e.bloodGroup);
  if (e.gender === "male") s.check("Male");
  else if (e.gender === "female") s.check("Female");
  else if (e.gender === "other") s.check("Other");
  s.under("FATHER'S NAME / SPOUSE NAME", e.fatherOrSpouseName);
  s.under("RELIGION (OPTIONAL)", e.religion);

  s.under("PERSONAL EMAIL ADDRESS", e.personalEmail);
  s.under("OFFICIAL EMAIL ADDRESS", e.email);
}

function fillPage2(s: Stamper, e: FormEmployee) {
  s.under("PRIMARY PHONE NUMBER", e.mobileNumber);
  s.under("ALTERNATE PHONE NUMBER", e.alternatePhone);
  s.under("PERMANENT ADDRESS", e.permanentAddress?.address, { maxWidth: 90 });
  s.under("CURRENT / CORRESPONDENCE ADDRESS (IF DIFFERENT FROM ABOVE)", e.currentAddress?.address, { maxWidth: 90, size: 9 });
  // The current address's own city/state/country/pin — it's the one somebody
  // can actually be reached at, and each label appears once on this page.
  s.under("CITY", e.currentAddress?.city ?? e.permanentAddress?.city);
  s.under("STATE", e.currentAddress?.state ?? e.permanentAddress?.state);
  s.under("COUNTRY", e.currentAddress?.country ?? e.permanentAddress?.country);
  s.under("PIN / ZIP CODE", e.currentAddress?.pin ?? e.permanentAddress?.pin);

  const contacts = e.emergencyContacts ?? [];
  if (contacts[0]) {
    s.under("FULL NAME (PRIMARY)", contacts[0].name);
    s.under("RELATIONSHIP", contacts[0].relation);
    s.under("PHONE NUMBER", contacts[0].phoneNumber);
  }
  // "RELATIONSHIP" and "PHONE NUMBER" print once per contact, so the second
  // occurrence needs to be found relative to the secondary row specifically,
  // not by label text alone — the first pass above already claimed the
  // primary row's.
  if (contacts[1]) {
    const secondary = findLabel(s.hits, "FULL NAME (SECONDARY)");
    if (secondary) {
      s.under("FULL NAME (SECONDARY)", contacts[1].name);
      s.underNearRow("RELATIONSHIP", secondary.y, contacts[1].relation);
      s.underNearRow("PHONE NUMBER", secondary.y, contacts[1].phoneNumber);
    }
  }

  // Education — the template's own row height, repeated downward for as
  // many rows as the person actually has, up to the five the table offers.
  const ROW_HEIGHT = 39;
  const cols = { qualification: 60, institute: 169.6, fieldOfStudy: 297.9, to: 388.6, grade: 472.2 };
  (e.education ?? []).slice(0, 5).forEach((row, i) => {
    s.tableRow("QUALIFICATION", i, ROW_HEIGHT, [
      { x: cols.qualification, text: row.qualification },
      { x: cols.institute, text: row.institute },
      { x: cols.fieldOfStudy, text: row.fieldOfStudy },
      { x: cols.to, text: row.to },
      { x: cols.grade, text: row.grade },
    ]);
  });
}

function fillPage3(s: Stamper, e: FormEmployee) {
  s.under("AADHAAR NUMBER", e.aadhaarNumber);
  s.under("PAN NUMBER", e.panNumber);
  s.under("PASSPORT NUMBER", e.passport?.passportNumber);
  s.under("PASSPORT EXPIRY DATE", fmtDate(e.passport?.expiryDate));
  s.under("EMIRATES ID NUMBER (IF APPLICABLE)", e.emiratesId?.idNumber);
  s.under("VISA EXPIRY DATE (IF APPLICABLE)", fmtDate(e.visa?.expiryDate));
  s.under("ACCOUNT HOLDER NAME", e.bank?.nameInBank);
  s.under("BANK NAME", e.bank?.bankName);
}

function fillPage4(s: Stamper, e: FormEmployee) {
  s.under("ACCOUNT NUMBER", e.bank?.bankAccountNumber);
  s.under("IFSC CODE / IBAN NUMBER", e.bank?.ibanIfsc);
  s.under("BRANCH NAME & CITY", e.bank?.branchName);
  if (e.bank?.accountType === "savings") s.check("Savings");
  else if (e.bank?.accountType === "current") s.check("Current");
}

function fillPage5(s: Stamper, e: FormEmployee) {
  const have = new Set((e.documents ?? []).map((d) => d.type));
  for (const { row, type } of CHECKLIST_FROM_DOCUMENTS) {
    if (have.has(type)) s.checkYesNear(row);
  }
  // The signature block is much tighter than the rest of the form — "NAME:"
  // and "SIGNATURE & DATE:" sit under 20pt apart, not the ~53pt every other
  // field's own answer space assumes, so this needs its own small offset.
  s.under("NAME:", e.name, { pageIndex: 4, below: 9, maxWidth: 40 });
}

/**
 * Fill this org's onboarding form for one employee. Read-only against the
 * employee record — generating this changes nothing about the person.
 */
export async function buildFilledOnboardingForm(employeeId: string, orgId: unknown): Promise<Buffer> {
  const template = await OnboardingFormTemplate.findOne({ organization: orgId, active: true }).sort({ version: -1 }).lean();
  if (!template) throw err("No onboarding form has been uploaded for this organisation yet", 404);
  const source = await getObjectBuffer(template.fileKey);
  if (!source) throw err("The onboarding form template could not be read", 500);

  const employee = await loadEmployee(employeeId, orgId);

  const pdf = await PDFDocument.load(source);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const hits = await extractPositionedText(source);
  const stamper = new Stamper(pdf.getPages(), font, hits);

  fillPage1(stamper, employee);
  fillPage2(stamper, employee);
  fillPage3(stamper, employee);
  fillPage4(stamper, employee);
  fillPage5(stamper, employee);

  return Buffer.from(await pdf.save());
}
