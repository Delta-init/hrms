import { Types } from "mongoose";
import { Application } from "../models/Application.js";
import { Candidate } from "../models/Candidate.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { LetterTemplate } from "../models/LetterTemplate.js";
import { OfferEmailTemplate } from "../models/OfferEmailTemplate.js";
import { OfferMail } from "../models/OfferMail.js";
import { MailboxCursor } from "../models/MailboxCursor.js";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { sendMailDetailed, mailboxAddress } from "../utils/mailer.js";
import { letterPdf } from "../utils/letterPdf.js";
import { signedFileUrl } from "../utils/fileUrl.js";
import { putObject, deleteObject, getObjectBuffer } from "./uploadService.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const fmtDate = (d?: Date | string | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(d)) : "";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Replace every {{token}} — blank when unknown, like letters. */
const render = (body: string, ctx: Record<string, string>) => body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => ctx[k] ?? "");

/** A storage-safe file name: letters, digits, dot, dash and underscore. */
const safeName = (name: string) => (name || "file").replace(/[^\w.-]+/g, "_").slice(-120);

const fileKey = (orgId: string | null, appId: string, name: string) =>
  `${orgId || "global"}/offers/${appId}/${Date.now()}-${safeName(name)}`;

/** File types worth keeping from a reply — a signed letter comes back as one of these. */
const KEEP = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/i;
const MAX_ATTACHMENT = 15 * 1024 * 1024;

/** The tag a reply-to address carries: hr+offer-<application id>@… */
const TAG = /\+offer-([a-f0-9]{24})@/i;

/** What a reply looks like by the time it reaches here — parsed, from whichever mailbox. */
export interface InboundMail {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  from: string;
  to: string[];
  subject?: string;
  date?: Date | null;
  text?: string;
  attachments: Array<{ filename?: string; contentType: string; size: number; content: Buffer; inline?: boolean }>;
}

/** The reply itself, without the quoted offer underneath it. */
function replyOnly(text: string) {
  const cut = text.search(/^(On .+wrote:|-{2,}\s*Original Message|From: .+)$/im);
  return (cut > 0 ? text.slice(0, cut) : text).trim().slice(0, 20000);
}

export class OfferService {
  // ── Email templates ────────────────────────────────────────────────────────

  async listTemplates() {
    return OfferEmailTemplate.find({ ...orgFilter() }).sort({ name: 1 }).lean();
  }

  /** Offer letter templates, for the hiring team — who may not hold the Letters permission. */
  async letterTemplates() {
    return LetterTemplate.find({ ...orgFilter(), category: "offer", status: "active" }).select("name subject").sort({ name: 1 }).lean();
  }

  async createTemplate(input: { name: string; subject: string; body: string; status?: "active" | "inactive" }, by: string) {
    if (await OfferEmailTemplate.findOne(scoped({ name: input.name.trim() }))) throw fail("A template with this name already exists", 409);
    return OfferEmailTemplate.create({ ...input, organization: getOrgId(), createdBy: by });
  }

  async updateTemplate(id: string, input: Partial<{ name: string; subject: string; body: string; status: "active" | "inactive" }>) {
    const t = await OfferEmailTemplate.findOne(scoped({ _id: id }));
    if (!t) throw fail("Template not found", 404);
    if (input.name && input.name.trim() !== t.name && (await OfferEmailTemplate.findOne(scoped({ name: input.name.trim() })))) {
      throw fail("A template with this name already exists", 409);
    }
    await OfferEmailTemplate.updateOne({ _id: t._id }, { $set: input });
    return OfferEmailTemplate.findById(t._id).lean();
  }

  async removeTemplate(id: string) {
    const t = await OfferEmailTemplate.findOneAndDelete(scoped({ _id: id }));
    if (!t) throw fail("Template not found", 404);
    return { message: "Template deleted" };
  }

  // ── Composing ──────────────────────────────────────────────────────────────

  private async load(applicationId: string) {
    const app = await Application.findOne(scoped({ _id: applicationId }));
    if (!app) throw fail("Application not found", 404);
    const candidate = await Candidate.findOne(scoped({ _id: app.candidate })).lean();
    if (!candidate) throw fail("Candidate not found", 404);
    const requisition = await JobRequisition.findOne(scoped({ _id: app.requisition }))
      .populate<{ department: { name?: string } | null }>("department", "name").lean();
    return { app, candidate, requisition };
  }

  /**
   * What {{tokens}} mean for a candidate. The `employee.*` names are the same
   * ones letter templates already use, so an existing Offer letter template
   * works unchanged; `candidate.*` and `offer.*` read better in new ones.
   */
  private async context(applicationId: string, joiningDate?: string | null) {
    const { app, candidate, requisition } = await this.load(applicationId);
    const org = await Organization.findById(getOrgId()).select("name code").lean<{ name?: string; code?: string } | null>();
    const currency = requisition?.currency || candidate.currency || "AED";
    const salary = app.offeredSalary != null ? `${currency} ${app.offeredSalary.toLocaleString("en-US")}` : "";
    const designation = requisition?.designation || requisition?.title || "";
    const department = requisition?.department?.name ?? "";
    const location = requisition?.location ? requisition.location[0].toUpperCase() + requisition.location.slice(1) : "";
    const employmentType = (requisition?.employmentType ?? "").replace(/_/g, " ");
    const joining = joiningDate ? fmtDate(joiningDate) : requisition?.targetStartDate ? fmtDate(requisition.targetStartDate) : "";
    const ctx: Record<string, string> = {
      "employee.name": candidate.name, "employee.email": candidate.email, "employee.phone": candidate.phone ?? "",
      "employee.designation": designation, "employee.department": department, "employee.joiningDate": joining,
      "employee.salary": salary, "employee.location": location, "employee.employmentType": employmentType,
      "employee.employeeCode": "", "employee.reportingTo": "", "employee.probationDays": "", "employee.confirmationDate": "",
      "candidate.name": candidate.name, "candidate.email": candidate.email, "candidate.phone": candidate.phone ?? "",
      "offer.position": designation, "offer.department": department, "offer.salary": salary,
      "offer.joiningDate": joining, "offer.location": location, "offer.employmentType": employmentType,
      "organization.name": org?.name ?? "", "organization.code": org?.code ?? "",
      "date.today": fmtDate(new Date()),
    };
    return { ctx, app, candidate, requisition, issuer: org?.name || "Delta HRMS" };
  }

  /** The offer with templates filled in, for HR to read and change before it goes. */
  async preview(applicationId: string, input: { emailTemplate?: string | null; letterTemplate?: string | null; joiningDate?: string | null }) {
    const { ctx, candidate } = await this.context(applicationId, input.joiningDate);
    const email = input.emailTemplate ? await OfferEmailTemplate.findOne(scoped({ _id: input.emailTemplate })).lean() : null;
    const letter = input.letterTemplate ? await LetterTemplate.findOne(scoped({ _id: input.letterTemplate })).lean() : null;
    if (input.emailTemplate && !email) throw fail("Email template not found", 404);
    if (input.letterTemplate && !letter) throw fail("Letter template not found", 404);
    return {
      to: candidate.email,
      subject: email ? render(email.subject, ctx) : `Offer of employment — ${ctx["offer.position"] || ctx["organization.name"]}`,
      body: email ? render(email.body, ctx) : "",
      letterSubject: letter ? render(letter.subject ?? "", ctx) : "",
      letterBody: letter ? render(letter.body, ctx) : "",
    };
  }

  /**
   * Send the offer. The letter becomes a PDF and goes as an attachment; replies
   * go to a tagged address on the HR mailbox so the inbox reader can tell
   * which offer they answer, whatever the candidate writes.
   *
   * Only an approved offer goes — the same line the pipeline holds. A send that
   * fails leaves nothing behind: no thread entry, no stored PDF.
   */
  async send(applicationId: string, input: { subject: string; body: string; letterSubject?: string; letterBody?: string }, by: string) {
    const { app, candidate, issuer } = await this.context(applicationId);
    if (app.status !== "active") throw fail(`This application is ${app.status}`);
    if (!["offer", "accepted"].includes(app.stage)) throw fail("Move them to Offer before sending one");
    if (app.offerApproval?.status !== "approved") throw fail("The offer has not been approved yet");
    if (!input.body.trim()) throw fail("Write the email");

    const orgId = getOrgId();
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    let letterKey: string | null = null;
    if (input.letterBody?.trim()) {
      const pdf = await letterPdf({ issuer, date: fmtDate(new Date()), subject: input.letterSubject?.trim() || "Offer of employment", body: input.letterBody, footer: `${issuer} · Offer for ${candidate.name}` });
      const fileName = `Offer letter - ${candidate.name}.pdf`;
      letterKey = fileKey(orgId, String(app._id), fileName);
      await putObject(letterKey, pdf, "application/pdf");
      attachments.push({ filename: fileName, content: pdf, contentType: "application/pdf" });
    }

    const mailbox = await mailboxAddress(orgId);
    const replyTo = mailbox ? mailbox.replace("@", `+offer-${String(app._id)}@`) : undefined;
    const mailId = new Types.ObjectId();
    const domain = mailbox?.split("@")[1] ?? "hrms.local";
    const messageId = `<offer.${String(mailId)}@${domain}>`;
    const html =
      `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:600px;color:#0f172a;line-height:1.6">` +
      input.body.trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") + `</div>`;

    const result = await sendMailDetailed({
      to: candidate.email, subject: input.subject.trim(), text: input.body, html,
      attachments, replyTo, messageId, organization: orgId,
    });
    if (!result.sent) {
      if (letterKey) await deleteObject(letterKey);
      throw fail(result.reason ?? "The email could not be sent");
    }

    await OfferMail.create({
      _id: mailId, organization: orgId, application: app._id, candidate: candidate._id,
      direction: "out", source: "email", subject: input.subject.trim(), from: result.from ?? mailbox ?? "",
      to: [candidate.email], text: input.body.slice(0, 20000), messageId,
      attachments: letterKey ? [{ key: letterKey, fileName: attachments[0].filename, contentType: "application/pdf", size: attachments[0].content.length }] : [],
      sentBy: by, at: new Date(),
    });
    app.offer = {
      ...(app.offer ?? {}),
      sentAt: new Date(), sentBy: by as never, sentCount: (app.offer?.sentCount ?? 0) + 1,
      ...(letterKey ? { letterKey } : {}),
    } as never;
    app.stageHistory = [...(app.stageHistory ?? []), { stage: "offer sent" as never, by: by as never, at: new Date(), note: candidate.email }];
    await app.save();
    return { message: `Offer sent to ${candidate.email}` };
  }

  // ── The thread ─────────────────────────────────────────────────────────────

  async thread(applicationId: string) {
    const app = await Application.findOne(scoped({ _id: applicationId })).select("offer").lean();
    if (!app) throw fail("Application not found", 404);
    const mails = await OfferMail.find(scoped({ application: app._id })).sort({ at: 1 }).populate("sentBy", "name").lean();
    return {
      offer: app.offer ? { ...app.offer, signedUrl: app.offer.signedKey ? signedFileUrl(app.offer.signedKey) : null } : null,
      mails: mails.map((m) => ({ ...m, attachments: (m.attachments ?? []).map((a) => ({ ...a, url: signedFileUrl(a.key) })) })),
    };
  }

  /** A signed copy that arrived some other way — WhatsApp, another address, by hand. */
  async uploadSigned(applicationId: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }, by: string) {
    const app = await Application.findOne(scoped({ _id: applicationId }));
    if (!app) throw fail("Application not found", 404);
    const key = fileKey(getOrgId(), String(app._id), file.originalname);
    await putObject(key, file.buffer, file.mimetype);
    await OfferMail.create({
      organization: getOrgId(), application: app._id, candidate: app.candidate, direction: "in", source: "upload",
      subject: "Signed offer uploaded", attachments: [{ key, fileName: file.originalname, contentType: file.mimetype, size: file.size }],
      sentBy: by, at: new Date(),
    });
    app.offer = { ...(app.offer ?? {}), signedAt: new Date(), signedKey: key, signedFileName: file.originalname, signedSource: "upload" } as never;
    await app.save();
    return this.thread(String(app._id));
  }

  /** Whether the inbox reader is connected, for the send dialog to say so. */
  async inboxStatus() {
    const c = await MailboxCursor.findOne({ organization: getOrgId(), mailbox: "INBOX" }).lean<{ lastCheckedAt?: Date | null; lastError?: string | null; lastErrorAt?: Date | null } | null>();
    return {
      mailbox: await mailboxAddress(getOrgId()),
      lastCheckedAt: c?.lastCheckedAt ?? null,
      lastError: c?.lastErrorAt && (!c.lastCheckedAt || c.lastErrorAt > c.lastCheckedAt) ? c.lastError ?? null : null,
    };
  }

  // ── Replies ────────────────────────────────────────────────────────────────

  /**
   * Which offer a reply answers, if any: the tagged reply-to address first,
   * then the email it says it is replying to, and last a recent offer sent to
   * the address it came from. Called inside the organisation's scope.
   */
  async match(mail: Pick<InboundMail, "to" | "inReplyTo" | "references" | "from">): Promise<string | null> {
    for (const addr of mail.to) {
      const m = addr.match(TAG);
      if (m && (await Application.exists(scoped({ _id: m[1] })))) return m[1];
    }
    const ids = [mail.inReplyTo, ...(mail.references ?? [])].filter(Boolean) as string[];
    if (ids.length) {
      const sent = await OfferMail.findOne(scoped({ direction: "out", messageId: { $in: ids } })).select("application").lean();
      if (sent) return String(sent.application);
    }
    const from = mail.from.trim().toLowerCase();
    if (!from) return null;
    const candidate = await Candidate.findOne(scoped({ email: from })).select("_id").lean();
    if (!candidate) return null;
    const recent = await Application.findOne(scoped({
      candidate: candidate._id, status: "active", "offer.sentAt": { $gte: new Date(Date.now() - 90 * 86_400_000) },
    })).sort({ "offer.sentAt": -1 }).select("_id").lean();
    return recent ? String(recent._id) : null;
  }

  /**
   * Store one reply: its text, and its attachments in storage. A reply with a
   * document attached is taken as the signed offer — HR sees it and decides —
   * and the people who handle hiring are told. Stored once, however many
   * times the reader sees it.
   */
  async ingest(mail: InboundMail): Promise<{ stored: boolean; applicationId?: string; signed?: boolean }> {
    const applicationId = await this.match(mail);
    if (!applicationId) return { stored: false };
    const orgId = getOrgId();
    if (mail.messageId && (await OfferMail.exists(scoped({ messageId: mail.messageId })))) return { stored: false, applicationId };
    const app = await Application.findOne(scoped({ _id: applicationId }));
    if (!app) return { stored: false };

    // Logos and signature images ride along inline; only real files are kept.
    const files = mail.attachments.filter((a) => KEEP.test(a.contentType) && a.size <= MAX_ATTACHMENT && !(a.inline && a.contentType.startsWith("image/") && a.size < 50_000));
    const attachments = [];
    for (const a of files) {
      const name = a.filename || `attachment.${a.contentType.split("/")[1] ?? "bin"}`;
      const key = fileKey(orgId, applicationId, name);
      await putObject(key, a.content, a.contentType);
      attachments.push({ key, fileName: name, contentType: a.contentType, size: a.size });
    }

    try {
      await OfferMail.create({
        organization: orgId, application: app._id, candidate: app.candidate, direction: "in", source: "email",
        subject: (mail.subject ?? "").slice(0, 300), from: mail.from, to: mail.to, text: replyOnly(mail.text ?? ""),
        messageId: mail.messageId ?? null, inReplyTo: mail.inReplyTo ?? null, attachments, at: mail.date ?? new Date(),
      });
    } catch (err) {
      // Another run stored it first.
      for (const a of attachments) await deleteObject(a.key);
      if ((err as { code?: number }).code === 11000) return { stored: false, applicationId };
      throw err;
    }

    const signed = attachments.find((a) => a.contentType === "application/pdf") ?? attachments[0];
    if (signed) {
      app.offer = { ...(app.offer ?? {}), signedAt: new Date(), signedKey: signed.key, signedFileName: signed.fileName, signedSource: "email" } as never;
      await app.save();
    }

    const candidate = await Candidate.findById(app.candidate).select("name").lean<{ name?: string } | null>();
    const people = [...(await watchersFor("hiring")), ...(app.offer?.sentBy ? [String(app.offer.sentBy)] : [])];
    await notify({
      users: people, kind: "approval", tone: signed ? "positive" : "neutral",
      title: signed ? `Signed offer received — ${candidate?.name ?? "candidate"}` : `Reply to offer — ${candidate?.name ?? "candidate"}`,
      body: signed ? `${signed.fileName} · accept them and create their employee record` : (mail.subject ?? ""),
      href: `/hiring/${String(app.requisition)}?offer=${applicationId}`,
    });
    return { stored: true, applicationId, signed: !!signed };
  }

  /**
   * On hire, the signed offer goes on the new employee's file as an HR
   * document. Copied, not shared: removing one later must not remove the other.
   */
  async fileSignedOffer(applicationId: string, employeeId: string) {
    const app = await Application.findOne(scoped({ _id: applicationId })).select("offer").lean();
    const key = app?.offer?.signedKey;
    if (!key) return;
    const buf = await getObjectBuffer(key);
    if (!buf) return;
    const name = app.offer?.signedFileName || "signed-offer.pdf";
    const contentType = /\.pdf$/i.test(name) ? "application/pdf" : /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "application/pdf";
    const copy = `${getOrgId() || "global"}/documents/${employeeId}/signed_offer-${Date.now()}-${safeName(name)}`;
    await putObject(copy, buf, contentType);
    await Employee.updateOne(scoped({ _id: employeeId }), {
      $push: { documents: { type: "signed_offer", fileName: name, fileKey: copy, mimeType: contentType, size: buf.length, uploadedAt: new Date(), uploadedBy: "hr" } },
    });
  }
}
