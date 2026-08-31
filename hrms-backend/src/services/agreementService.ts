import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { DocumentTemplate } from "../models/DocumentTemplate.js";
import { FaceProfile } from "../models/FaceProfile.js";
import { faceServiceEnabled } from "../services/faceClient.js";
import { r2, R2_BUCKET } from "../config/r2.js";
import { scoped } from "../utils/orgContext.js";
import { extractPositionedText, findLabel, findAllLabels, type TextHit } from "../utils/pdfText.js";

export type Variant = "onsite" | "remote";
export type Kind = "nda" | "tc";

export const fail = (message: string, statusCode = 400, code?: string) =>
  Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });

/**
 * Which set of documents this person signs.
 *
 * Work mode is the onsite/remote split, and an unclassified employee is
 * refused rather than defaulted. The field defaults to "office" when a record
 * is saved, so a deliberate choice and a default look identical — except that
 * a record written before the field existed has no `workMode` at all, and that
 * absence is what this reads.
 *
 * Getting it wrong means somebody signs the wrong contract, which is not a
 * mistake a later deploy undoes. Refusing is the only safe default.
 */
export function variantFor(employee: { workMode?: string | null }): Variant {
  const mode = employee.workMode;
  if (mode !== "office" && mode !== "wfh") {
    throw fail(
      "No work mode is set for this employee, so we cannot tell which agreements apply. HR must mark them Office or Work from home first.",
      409,
      "WORK_MODE_UNSET"
    );
  }
  return mode === "wfh" ? "remote" : "onsite";
}

/** The current NDA and terms for a variant. Both must exist before anyone signs. */
export async function activeTemplates(variant: Variant) {
  const rows = await DocumentTemplate.find(scoped({ variant, active: true })).lean();
  const byKind = new Map(rows.map((r) => [r.kind as Kind, r]));
  const missing = (["nda", "tc"] as Kind[]).filter((k) => !byKind.get(k));
  if (missing.length) {
    throw fail(
      `No ${missing.map((m) => (m === "nda" ? "NDA" : "terms & conditions")).join(" or ")} has been uploaded for ${variant} staff yet. An administrator must upload the agreements before anyone can sign.`,
      409,
      "TEMPLATES_MISSING"
    );
  }
  return byKind;
}

export async function fetchObject(key: string): Promise<Buffer> {
  if (!r2) throw fail("File storage is not configured", 500);
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  for await (const c of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

export interface Particulars {
  name: string; nationality?: string; passport?: string; jobRole?: string;
  contact?: string; homeAddress?: string; uaeAddress?: string;
}

/** Break on spaces where possible; hard-break a token that is simply too long. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const word of text.split(" ")) {
    if (!out.length) { out.push(word); continue; }
    const last = out[out.length - 1];
    if ((last + " " + word).length <= width) out[out.length - 1] = last + " " + word;
    else if (word.length <= width) out.push(word);
    else { let w = word; while (w.length > width) { out.push(w.slice(0, width)); w = w.slice(width); } out.push(w); }
  }
  return out;
}

/** Reject anything that is not a PNG before pdf-lib meets it. */
function pngOrFail(buf: Buffer): Buffer {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw fail("The signature must be a PNG image", 400);
  }
  return buf;
}

/**
 * Append the signature to a document.
 *
 * A page of its own, rather than ink dropped onto the existing signature
 * block. These PDFs are flat — the blanks after "Name:" and "Signature:" are
 * ordinary text, not form fields — so placing anything precisely would mean
 * guessing coordinates and trusting the layout never changes. A signature
 * drawn across a clause because the terms gained a paragraph is worse than one
 * on a page that says plainly what it is.
 *
 * The page also carries the particulars the document's header asks for, which
 * the employee record already holds, and the hash of the exact file signed.
 */
export async function appendSignaturePage(
  source: Buffer,
  opts: {
    title: string; particulars: Particulars; signaturePng: Buffer; typedName: string;
    signedAt: Date; sourceSha256: string; ip?: string | null; videoNote: string;
  }
): Promise<Buffer> {
  const pdf = await PDFDocument.load(source);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const png = await pdf.embedPng(pngOrFail(opts.signaturePng));

  /**
   * The document is edited, not added to.
   *
   * The signature goes on the document's own signature line and the particulars
   * into the fields that ask for them, so what comes out is the agreement that
   * was uploaded, signed — not an unsigned one with a certificate stapled to
   * the back. Everything the appended page used to record still exists: the IP,
   * the hash of exactly what was signed, and the induction watch time are on the
   * signing record and shown to whoever reviews it.
   *
   * The page is kept for one case only. If nothing could be filled — a template
   * redesigned past recognition, or a scan with no text layer — returning the
   * original untouched would hand back a "signed" document with no signature
   * anywhere on it. Then, and only then, the evidence page is appended so the
   * signature exists somewhere.
   */
  const filled = await fillSignatureFields(pdf, source, opts);
  if (filled > 0) return Buffer.from(await pdf.save());

  const page = pdf.addPage([595.28, 841.89]); // A4
  const grey = rgb(0.35, 0.35, 0.38);
  const ink = rgb(0.1, 0.1, 0.12);
  let y = 780;
  const line = (text: string, size = 10, f = font, colour = ink, gap = 16) => {
    page.drawText(text, { x: 56, y, size, font: f, color: colour });
    y -= gap;
  };

  line("ELECTRONIC SIGNATURE", 13, bold, ink, 10);
  line(opts.title, 10, font, grey, 26);

  line("Employee particulars", 11, bold, ink, 18);
  const p = opts.particulars;
  for (const [label, value] of [
    ["Name", p.name], ["Nationality", p.nationality], ["Passport number and issue date", p.passport],
    ["Address (home country)", p.homeAddress], ["Address (UAE)", p.uaeAddress],
    ["Job role", p.jobRole], ["Contact number", p.contact],
  ] as Array<[string, string | undefined]>) {
    page.drawText(`${label}:`, { x: 56, y, size: 9, font, color: grey });
    page.drawText((value || "—").slice(0, 70), { x: 230, y, size: 9, font: bold, color: ink });
    y -= 14;
  }

  y -= 16;
  line("Signed by", 11, bold, ink, 10);
  const w = 180, h = Math.min((png.height / png.width) * w, 70);
  page.drawImage(png, { x: 56, y: y - h, width: w, height: h });
  y -= h + 8;
  page.drawLine({ start: { x: 56, y }, end: { x: 56 + w, y }, thickness: 0.7, color: grey });
  y -= 14;
  line(opts.typedName, 10, bold, ink, 14);
  line(`${opts.signedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`, 9, font, grey, 26);

  line("Verification", 11, bold, ink, 16);
  for (const t of [
    `Document fingerprint (SHA-256): ${opts.sourceSha256}`,
    `Signed from IP: ${opts.ip || "unrecorded"}`,
    opts.videoNote,
    "The document's own name and signature lines could not be located, so this page is the only record of the signature.",
    "Generated by Delta HRMS at the moment of signing; it forms part of the agreement.",
  ]) {
    for (const chunk of wrap(t, 92)) { page.drawText(chunk, { x: 56, y, size: 8, font, color: grey }); y -= 11; }
    y -= 3;
  }

  return Buffer.from(await pdf.save());
}

/**
 * Fill the document's own name and signature lines.
 *
 * These are flat PDFs — no form fields — so there is nothing to fill in the
 * usual sense. The labels are real text, though, so they can be found and
 * written beside: "Signature:" on the signing page, and the particulars block
 * the NDA's first page asks for. Coordinates come from the file being signed,
 * not from a table in this code, so a template re-uploaded with a different
 * layout still signs in the right place.
 *
 * Best-effort by design, and never fatal. A redesigned template, or one that is
 * a scan with no text layer at all, simply leaves nothing filled — the appended
 * page still records the signature in full. Losing somebody's signature because
 * a heading was reworded would be a far worse failure than a document that has
 * to be read to the end.
 *
 * Returns how many fields were written, which the caller records so an
 * administrator can see that a template has stopped matching.
 */
async function fillSignatureFields(
  pdf: PDFDocument,
  source: Buffer,
  opts: { particulars: Particulars; signaturePng: Buffer; typedName: string; signedAt: Date }
): Promise<number> {
  let filled = 0;
  try {
    const hits = await extractPositionedText(source);
    if (!hits.length) return 0;

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const ink = rgb(0.06, 0.09, 0.35);
    const pages = pdf.getPages();
    const p = opts.particulars;

    /** Write a value just after a label, on the label's own baseline. */
    const write = (hit: TextHit, value: string, size = 9) => {
      const page = pages[hit.pageIndex];
      if (!page || !value) return;
      const room = hit.pageWidth - hit.xEnd - 24;
      let text = value;
      while (font.widthOfTextAtSize(text, size) > room && text.length > 4) text = text.slice(0, -2);
      page.drawText(text, { x: hit.xEnd + 6, y: hit.y, size, font, color: ink });
      filled++;
    };

    // ── The particulars block the NDA opens with ──
    for (const [label, value] of [
      ["Nationality:", p.nationality],
      ["Passport Number and Issue date:", p.passport],
      ["Address (Home Country):", p.homeAddress],
      ["Address (UAE):", p.uaeAddress],
      ["Job role:", p.jobRole],
      ["Contact Number:", p.contact],
    ] as Array<[string, string | undefined]>) {
      const hit = findLabel(hits, label);
      if (hit && value) write(hit, value);
    }
    /**
     * The "Name:" that heads the particulars block, and only that one.
     *
     * Taking the first "Name" in the document put the employee's name in the
     * header of the terms' board-of-directors table — the column heading reads
     * "Name", and normalising punctuation away made it match "Name:". So it is
     * anchored instead: the particulars name is the one directly above
     * "Nationality:", which is the line that only ever appears in that block.
     * A document without that line has no particulars block and gets nothing.
     */
    const names = findAllLabels(hits, "Name:");
    const nationality = findLabel(hits, "Nationality:");
    const particularsName = nationality
      ? names.find(
          (n) =>
            n.pageIndex === nationality.pageIndex &&
            n.y > nationality.y &&
            n.y - nationality.y < 40 &&
            Math.abs(n.x - nationality.x) < 12
        )
      : null;
    if (particularsName && p.name) write(particularsName, p.name);

    // ── The signature block ──
    // The NDA signs in two columns and both say "Signature:"; the employee's is
    // the right-hand one. Signing the left would sign for the company.
    const sig = findLabel(hits, "Signature:", { preferRight: true });
    // The signer's name: the terms label it plainly, the NDA uses the "Name:"
    // in its signature block — the last one, and never the particulars one.
    const signerName =
      findLabel(hits, "Employee Name:") ??
      [...names].reverse().find((n) => n !== particularsName) ??
      null;
    if (signerName) write(signerName, opts.typedName, 10);

    const designation = findLabel(hits, "Designation");
    if (designation && p.jobRole) write(designation, p.jobRole);

    // On the page the signature is on, so a "Date:" elsewhere in the document
    // is never mistaken for the one that dates the signing.
    const date = findLabel(hits, "Date:", sig ? { pageIndex: sig.pageIndex } : {});
    if (date) write(date, opts.signedAt.toISOString().slice(0, 10));

    if (sig) {
      const page = pages[sig.pageIndex];
      const png = await pdf.embedPng(pngOrFail(opts.signaturePng));
      // Sized to sit on the line rather than tower over it, and never wider than
      // the space before the page edge or the next column.
      const height = 22;
      const width = Math.min((png.width / png.height) * height, sig.pageWidth - sig.xEnd - 30);
      page.drawImage(png, { x: sig.xEnd + 8, y: sig.y - 4, width, height });
      filled++;
    }
  } catch {
    // A file pdfjs cannot read is not a reason to refuse the signing.
    return filled;
  }
  return filled;
}

export const addr = (a?: { address?: string; city?: string; state?: string; country?: string } | null) =>
  a ? [a.address, a.city, a.state, a.country].filter(Boolean).join(", ") : "";

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

// ── Orchestration ────────────────────────────────────────────────────────────
import { Employee } from "../models/Employee.js";
import { SignedAgreement } from "../models/SignedAgreement.js";
import { putObject } from "./uploadService.js";
import { getOrgId } from "../utils/orgContext.js";
import { beginWorkflowState, resolveReviewOutcome, assertNotSelfReview } from "./approvalWorkflowService.js";
import { viewFor } from "./inductionService.js";
import { publicUrl } from "../config/r2.js";
import { Organization } from "../models/Organization.js";

const TITLES: Record<Kind, string> = {
  nda: "Employee Non-Disclosure and Non-Compete Agreement",
  tc: "Terms & Conditions of Employment",
};

async function employeeFor(userId: string) {
  const employee = await Employee.findOne(scoped({ user: userId })).lean();
  if (!employee) throw fail("No employee record is linked to this account", 404, "NO_EMPLOYEE");
  return employee;
}

/** Everything the onboarding gate needs to render itself. */
export async function myState(userId: string) {
  const employee = await employeeFor(userId);
  const org = await Organization.findById(getOrgId())
    .select("settings.requireAgreements settings.requireFaceEnrollment")
    .lean<{ settings?: { requireAgreements?: boolean; requireFaceEnrollment?: boolean } } | null>();
  const required = !!org?.settings?.requireAgreements;

  /**
   * Whether a face is part of finishing onboarding.
   *
   * Asked for only when the matching service is actually configured. Otherwise
   * the step is one nothing on earth can complete, and requiring it would hold
   * every new joiner at a wall because a server somewhere is unreachable — the
   * same reason the gate never blocks on an answer it could not work out.
   */
  const faceRequired = !!org?.settings?.requireFaceEnrollment && faceServiceEnabled;
  const faceEnrolled = faceRequired
    ? !!(await FaceProfile.exists(scoped({ user: userId })))
    : false;
  const variant = variantFor(employee);
  const templates = await activeTemplates(variant);
  const induction = await viewFor(userId);

  const latest = await SignedAgreement.findOne(scoped({ user: userId }))
    .sort({ createdAt: -1 })
    .lean();

  return {
    required,
    variant,
    documents: (["nda", "tc"] as Kind[]).map((kind) => {
      const t = templates.get(kind)!;
      return { kind, title: TITLES[kind], version: t.version, url: publicUrl(t.fileKey), fileName: t.fileName };
    }),
    video: induction?.video
      ? { title: induction.video.title, durationSeconds: induction.video.durationSeconds, url: publicUrl(induction.video.fileKey) }
      : null,
    videoCompleted: !!induction?.view?.completedAt,
    agreement: latest
      ? {
          _id: latest._id,
          status: latest.status,
          signedAt: latest.signedAt,
          reviewNote: latest.reviewNote,
          /**
           * What they actually signed — their name and signature on the
           * document, not the blank template above. Somebody who has just put
           * their name to two agreements should be able to read back what they
           * put it to, and keep a copy, without asking HR for it.
           */
          documents: (latest.documents ?? []).map((d) => ({
            kind: d.kind,
            version: d.version,
            url: publicUrl(d.signedKey),
          })),
        }
      : null,
    faceRequired,
    faceEnrolled,
    /**
     * The gate lifts once they have signed, not once HR has got round to it.
     *
     * Verification is HR's job and it happens on HR's schedule; holding
     * somebody out of the system until it does means a new joiner sits locked
     * out for however long the queue takes, having done everything asked of
     * them. The signing is recorded either way, and a rejection puts them back
     * at the gate to sign again — which is the point at which their access
     * should actually stop.
     */
    cleared: !!latest && latest.status !== "rejected" && (!faceRequired || faceEnrolled),
  };
}

/**
 * Sign both agreements in one act.
 *
 * Refused unless the induction is complete on the server's own reckoning, and
 * unless the file about to be signed still hashes to what the template says —
 * if the stored object changed since it was uploaded, nobody signs it until
 * somebody works out why.
 */
export async function sign(
  userId: string,
  input: { signaturePng: string; typedName: string },
  ctx: { ip?: string | null; userAgent?: string | null }
) {
  const employee = await employeeFor(userId);
  const variant = variantFor(employee);
  const templates = await activeTemplates(variant);

  const induction = await viewFor(userId);
  if (!induction?.view?.completedAt) {
    throw fail("Finish the induction video before signing", 409, "VIDEO_INCOMPLETE");
  }

  const open = await SignedAgreement.findOne(scoped({ user: userId, status: { $in: ["pending", "approved"] } })).lean();
  if (open) {
    throw fail(
      open.status === "approved" ? "Your agreements are already signed and approved" : "Your signed agreements are already with HR",
      409,
      "ALREADY_SIGNED"
    );
  }

  const signaturePng = Buffer.from(input.signaturePng.replace(/^data:image\/png;base64,/, ""), "base64");
  if (signaturePng.length < 200) throw fail("The signature looks empty — please sign again", 400);

  const signedAt = new Date();
  const particulars: Particulars = {
    name: employee.name,
    nationality: employee.nationality,
    passport: [employee.passport?.passportNumber, employee.passport?.issueDate ? new Date(employee.passport.issueDate).toISOString().slice(0, 10) : ""]
      .filter(Boolean).join(" · "),
    jobRole: employee.designation,
    contact: employee.mobileNumber || employee.phone,
    homeAddress: addr(employee.permanentAddress),
    uaeAddress: addr(employee.currentAddress),
  };
  const watched = Math.round(induction.view.watchedSeconds);
  const videoNote = `Induction video completed ${induction.view.completedAt.toISOString().slice(0, 19).replace("T", " ")} UTC (${watched}s of ${induction.video.durationSeconds}s credited).`;

  const sigKey = `agreements/${employee._id}/signature-${signedAt.getTime()}.png`;
  await putObject(sigKey, signaturePng, "image/png");

  const documents = [];
  for (const kind of ["nda", "tc"] as Kind[]) {
    const t = templates.get(kind)!;
    const source = await fetchObject(t.fileKey);
    // The template records the hash it was uploaded with. If the object no
    // longer matches, something replaced it out of band and no signature
    // should be attached to it.
    const actual = sha256(source);
    if (actual !== t.sha256) {
      throw fail(`The stored ${kind.toUpperCase()} no longer matches its recorded fingerprint. An administrator should re-upload it.`, 409, "TEMPLATE_TAMPERED");
    }
    const out = await appendSignaturePage(source, {
      title: `${TITLES[kind]} — ${variant === "remote" ? "Remote" : "Onsite"} (v${t.version})`,
      particulars, signaturePng, typedName: input.typedName, signedAt,
      sourceSha256: actual, ip: ctx.ip, videoNote,
    });
    const signedKey = `agreements/${employee._id}/${kind}-v${t.version}-${signedAt.getTime()}.pdf`;
    await putObject(signedKey, out, "application/pdf");
    documents.push({ template: t._id, kind, version: t.version, sourceSha256: actual, signedKey });
  }

  const workflow = await beginWorkflowState("agreements");
  const record = await SignedAgreement.create({
    organization: getOrgId(),
    employee: employee._id, user: userId, variant, documents,
    signatureKey: sigKey, typedName: input.typedName.trim().slice(0, 120), signedAt,
    ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    videoView: induction.view._id,
    status: "pending", ...workflow,
  });
  return record;
}

/**
 * HR verifies a signing.
 *
 * Lives here rather than in the controller so the approvals console and the
 * agreements page decide the same way — two review paths that disagree about
 * what "approved" means is how a record ends up in a state neither built.
 *
 * Rejection sends the employee back to sign again rather than deleting
 * anything: "signed, rejected, re-signed" should stay readable afterwards.
 */
export async function reviewSignedAgreement(
  id: string,
  approve: boolean,
  note: string | null,
  reviewerUserId: string,
  reviewerRole: Parameters<typeof resolveReviewOutcome>[4]
) {
  const record = await SignedAgreement.findOne(scoped({ _id: id }));
  if (!record) throw fail("Not found", 404);
  if (record.status !== "pending") throw fail(`This signing was already ${record.status}`, 409);

  // Verifying your own signature is exactly what this guard is for.
  assertNotSelfReview(record.user, reviewerUserId);

  const action = approve ? "approved" : "rejected";
  const outcome = resolveReviewOutcome(record.approvalSteps as never, record.workflowStep, action, note, reviewerRole);
  record.approvalTrail.push(outcome.trailEntry as never);
  if (outcome.advance) {
    record.workflowStep = (record.workflowStep ?? 1) + 1;
  } else {
    record.status = action;
    record.reviewedBy = reviewerUserId as never;
    record.reviewedAt = new Date();
    record.reviewNote = note ?? undefined;
    record.workflowStep = null;
  }
  await record.save();
  return record;
}
