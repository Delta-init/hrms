import { Procurement } from "../models/Procurement.js";
import { User } from "../models/User.js";
import type {
  CreateProcurementInput, UpdateProcurementInput, ReviewProcurementInput, ResubmitProcurementInput,
} from "../validations/procurementValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { env } from "../config/env.js";

const POP = [
  { path: "department", select: "name code" },
  { path: "requestedBy", select: "name email" },
  { path: "hrReviewedBy", select: "name email" },
];

/** The states a request passes through before anyone has bought anything. */
const APPROVAL_STATES = ["requested", "hr_approved", "approved", "rejected"] as const;

interface ProcurementQuery extends PaginationQuery {
  status?: string;
  kind?: string;
  category?: string;
  department?: string;
}

export class ProcurementService {
  /**
   * Tell whoever raised it what happened to it.
   *
   * Best effort, and always after the record is saved: a mail server having a
   * bad afternoon must not turn a decision that was made into one that wasn't.
   */
  private async tellRequester(
    record: { _id: unknown; item: string; requestedBy?: unknown; status: string },
    headline: string,
    note?: string | null
  ) {
    try {
      if (!record.requestedBy) return;
      const user = await User.findById(record.requestedBy).select("name email").lean<{ name?: string; email?: string } | null>();
      if (!user?.email) return;
      const link = `${env.CLIENT_URL}/assets`;
      await sendMail({
        to: user.email,
        organization: String(getOrgId() ?? ""),
        subject: `${record.item}: ${headline}`,
        text: `Hi ${user.name ?? "there"},\n\nYour procurement request for "${record.item}" ${headline}.\n` +
          (note ? `\nNote: ${note}\n` : "") + `\n${link}\n`,
        html:
          `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
          `<h2 style="color:#4f46e5;margin-bottom:4px">${headline}</h2>` +
          `<p style="color:#555">Your request for <strong>${record.item}</strong> ${headline}.</p>` +
          (note ? `<p style="color:#555">Note: ${note}</p>` : "") +
          `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open procurement</a></p>` +
          `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
      });
    } catch {
      /* the decision stands whether or not the mail got out */
    }
  }

  /**
   * Tell the people who decide these what was decided.
   *
   * The requester hears from `tellRequester`; this is the other side of the
   * desk — whoever holds `procurement.approve`, which is the same question
   * office keeping asks when a request comes in. Read from the permission
   * rather than a role name, so renaming a role or adding a second approver
   * cannot silently empty the list.
   *
   * Whoever made the decision is dropped from it. An email telling somebody
   * what they have just clicked is noise, and noise is how a mailbox rule gets
   * written that hides the ones that matter.
   */
  private async tellApprovers(
    record: { item: string; requestedBy?: unknown },
    headline: string,
    note?: string | null,
    decidedBy?: string
  ) {
    try {
      const skip = new Set([String(decidedBy ?? ""), String(record.requestedBy ?? "")]);
      const ids = (await watchersFor("procurement")).filter((id) => !skip.has(id));
      if (!ids.length) return;

      try {
        await notify({
          users: ids,
          kind: "approval",
          title: `${record.item}: ${headline}`,
          body: note ?? "",
          href: "/assets",
          actor: decidedBy,
        });
      } catch {
        /* the mail below is the part that carries */
      }

      const people = await User.find({ _id: { $in: ids }, status: { $ne: "inactive" } })
        .select("name email")
        .lean<Array<{ name?: string; email?: string }>>();
      const link = `${env.CLIENT_URL}/assets`;

      for (const person of people) {
        if (!person.email) continue;
        await sendMail({
          to: person.email,
          organization: String(getOrgId() ?? ""),
          subject: `${record.item}: ${headline}`,
          text: `Hi ${person.name ?? "there"},\n\nThe request for "${record.item}" ${headline}.\n` +
            (note ? `\nNote: ${note}\n` : "") + `\n${link}\n`,
          html:
            `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
            `<h2 style="color:#4f46e5;margin-bottom:4px">${headline}</h2>` +
            `<p style="color:#555">The request for <strong>${record.item}</strong> ${headline}.</p>` +
            (note ? `<p style="color:#555">Note: ${note}</p>` : "") +
            `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open procurement</a></p>` +
            `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
        });
      }
    } catch {
      /* a decision that was made must not depend on the post going out */
    }
  }

  async create(input: CreateProcurementInput, requestedBy: string) {
    const kind = input.kind ?? "existing";
    // A request starts by being asked for; a record of something already bought
    // never enters the approval states at all.
    const status = kind === "new"
      ? "requested"
      : (input.status && !APPROVAL_STATES.includes(input.status as never) ? input.status : "ordered");

    const record = await Procurement.create({
      ...input,
      kind,
      status,
      department: input.department || null,
      organization: getOrgId(),
      requestedBy,
    });

    if (kind === "new") {
      await notify({
        users: await watchersFor("procurement", requestedBy),
        kind: "approval",
        title: `${input.item} requested`,
        body: `${input.quantity ?? 1} × ${input.item}`,
        href: "/assets",
        actor: requestedBy,
      });
    }
    return Procurement.findById(record._id).populate(POP);
  }

  async list(query: ProcurementQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.item = searchRegex(query.search);
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.kind) filter.kind = query.kind;
    if (query.category) filter.category = query.category;
    if (query.department) filter.department = query.department;

    const sortable = new Set(["item", "quantity", "estimatedCost", "neededBy", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Procurement.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Procurement.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Procurement.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateProcurementInput) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });

    // Once it is with HR or finance, editing it underneath them would mean they
    // decided one thing and a different thing got bought.
    if (record.kind === "new" && (record.status === "hr_approved" || record.status === "approved")) {
      throw Object.assign(
        new Error("This request has been approved and can no longer be edited"),
        { statusCode: 409 }
      );
    }

    const patch: Record<string, unknown> = { ...input };
    if (input.department !== undefined) patch.department = input.department || null;
    // The kind decides which states are legal, so it is not a field an edit
    // may flip — a record halfway through approval cannot become history.
    delete patch.kind;

    await Procurement.updateOne({ _id: record._id }, { $set: patch });
    return Procurement.findById(record._id).populate(POP);
  }

  /** HR's decision: approve it on to finance, or refuse it here. */
  async review(id: string, input: ReviewProcurementInput, reviewerId: string) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (record.kind !== "new") {
      throw Object.assign(new Error("Only a new request needs approving"), { statusCode: 400 });
    }
    if (record.status !== "requested") {
      throw Object.assign(new Error("This request has already been decided"), { statusCode: 400 });
    }

    const approved = input.decision === "approve";
    await Procurement.updateOne({ _id: record._id }, {
      $set: {
        status: approved ? "hr_approved" : "rejected",
        hrReviewedBy: reviewerId,
        hrReviewedAt: new Date(),
        hrNote: input.note ?? "",
        rejectedBy: approved ? null : "hr",
      },
    });

    const hrHeadline = approved ? "has been approved by HR and sent to finance" : "was not approved by HR";
    await this.tellRequester(record as never, hrHeadline, input.note);
    await this.tellApprovers(record as never, hrHeadline, input.note, reviewerId);
    return Procurement.findById(record._id).populate(POP);
  }

  /**
   * Revise a refused request and send it back round.
   *
   * The count is kept rather than the record being replaced, because a fourth
   * attempt is worth knowing about and a new row would lose the history.
   */
  async resubmit(id: string, input: ResubmitProcurementInput) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (record.status !== "rejected") {
      throw Object.assign(new Error("Only a rejected request can be resubmitted"), { statusCode: 400 });
    }

    const patch: Record<string, unknown> = { ...input };
    if (input.department !== undefined) patch.department = input.department || null;

    await Procurement.updateOne({ _id: record._id }, {
      $set: {
        ...patch,
        status: "requested",
        rejectedBy: null,
        hrReviewedBy: null, hrReviewedAt: null, hrNote: "",
        financeReviewedAt: null, financeNote: "",
      },
      $inc: { resubmitCount: 1 },
    });
    return Procurement.findById(record._id).populate(POP);
  }

  async remove(id: string) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    await Procurement.deleteOne({ _id: record._id });
    return { message: "Procurement deleted successfully" };
  }

  // ── Finance integration ────────────────────────────────────────────────────
  // Called from signed machine requests, which carry the organization
  // explicitly because there is no logged-in user to infer it from.

  /** What is sitting with finance, waiting on the money decision. */
  async listForFinance(organization: string) {
    return Procurement.find({ organization, kind: "new", status: "hr_approved" })
      .populate(POP)
      .sort({ neededBy: 1, createdAt: 1 })
      .lean();
  }

  /** Record what finance decided, and tell whoever asked. */
  async recordFinanceDecision(
    organization: string,
    id: string,
    input: { decision: "approve" | "reject"; note?: string | null; purchaseOrderRef?: string | null }
  ) {
    const record = await Procurement.findOne({ _id: id, organization });
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (record.status !== "hr_approved") {
      throw Object.assign(
        new Error("Only a request HR has approved is waiting on finance"),
        { statusCode: 409 }
      );
    }

    const approved = input.decision === "approve";
    await Procurement.updateOne({ _id: record._id }, {
      $set: {
        status: approved ? "approved" : "rejected",
        financeReviewedAt: new Date(),
        financeNote: input.note ?? "",
        purchaseOrderRef: approved ? (input.purchaseOrderRef ?? "") : "",
        rejectedBy: approved ? null : "finance",
      },
    });

    const financeHeadline = approved ? "has been approved by finance" : "was not approved by finance";
    await this.tellRequester(record as never, financeHeadline, input.note);
    // The decision was made in the finance system, so there is no HRMS user to
    // leave out — everybody who approves these hears about it.
    await this.tellApprovers(record as never, financeHeadline, input.note);
    return Procurement.findById(record._id).populate(POP).lean();
  }
}
