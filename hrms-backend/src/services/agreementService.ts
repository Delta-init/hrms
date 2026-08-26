import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { DocumentTemplate } from "../models/DocumentTemplate.js";
import { r2, R2_BUCKET } from "../config/r2.js";
import { scoped } from "../utils/orgContext.js";

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
    "Generated by Delta HRMS at the moment of signing; it forms part of the agreement.",
  ]) {
    for (const chunk of wrap(t, 92)) { page.drawText(chunk, { x: 56, y, size: 8, font, color: grey }); y -= 11; }
    y -= 3;
  }

  return Buffer.from(await pdf.save());
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
  const org = await Organization.findById(getOrgId()).select("settings.requireAgreements")
    .lean<{ settings?: { requireAgreements?: boolean } } | null>();
  const required = !!org?.settings?.requireAgreements;
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
      ? { _id: latest._id, status: latest.status, signedAt: latest.signedAt, reviewNote: latest.reviewNote }
      : null,
    /** The gate lifts only on an approved signing. */
    cleared: latest?.status === "approved",
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
