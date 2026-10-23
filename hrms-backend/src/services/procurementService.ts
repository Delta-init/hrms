import { Procurement } from "../models/Procurement.js";
import { User } from "../models/User.js";
import type {
  CreateProcurementInput, UpdateProcurementInput, ReviewProcurementInput, ResubmitProcurementInput,
} from "../validations/procurementValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { publicUrl, deleteObject } from "./uploadService.js";
import { departmentsHeadedBy } from "./departmentHeadService.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { sendWhatsAppToUsers } from "./whatsappService.js";
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
  /** Raised on or after / on or before these days (YYYY-MM-DD). */
  from?: string;
  to?: string;
}

/**
 * A stored request with its report as a link rather than a key.
 *
 * The link is signed and short-lived, so it is minted per response rather
 * than stored — same reasoning as a candidate's CV or a requisition's JD.
 */
function shape<T extends { reportKey?: string | null }>(doc: T | null) {
  if (!doc) return doc;
  return { ...doc, reportUrl: doc.reportKey ? publicUrl(doc.reportKey) : "" };
}

/**
 * Which procurement finance asks for (2026-10-23): its queue (hr_approved, the default — what HR has passed on and
 * waits on the money decision), or its full record — one status, or all — both kinds, newest first.
 */
export const FINANCE_PROCUREMENT_STATUSES = ["hr_approved", "requested", "approved", "rejected", "ordered", "received", "cancelled", "all"] as const;
export type FinanceProcurementStatus = (typeof FINANCE_PROCUREMENT_STATUSES)[number];

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
    decidedBy?: string,
    /** Tell these instead of procurement's approvers — see `facilitiesOnly`. */
    recipients?: string[]
  ) {
    try {
      const skip = new Set([String(decidedBy ?? ""), String(record.requestedBy ?? "")]);
      const ids = (recipients ?? (await watchersFor("procurement"))).filter((id) => !skip.has(id));
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

  /**
   * Everybody who should hear that something is being bought: whoever
   * approves procurement, and whoever runs office keeping.
   *
   * The second group is here for the office assistant. He goes and buys the
   * thing once it's approved, so he needs to know about it — but approving
   * spend is not his to do, so he holds office keeping's `approve`, not
   * procurement's. Both halves are read from permissions, never from names.
   */
  private async facilitiesPeople(exclude?: unknown): Promise<string[]> {
    const [proc, office] = await Promise.all([watchersFor("procurement"), watchersFor("officeKeeping")]);
    return [...new Set([...proc, ...office])].filter((id) => id !== String(exclude ?? ""));
  }

  /** Office keeping's people who don't also approve procurement — told separately
   *  because procurement's approvers already hear through `tellApprovers`. */
  private async facilitiesOnly(): Promise<string[]> {
    const [proc, office] = await Promise.all([watchersFor("procurement"), watchersFor("officeKeeping")]);
    const approvers = new Set(proc);
    return office.filter((id) => !approvers.has(id));
  }

  async create(input: CreateProcurementInput, requestedBy: string) {
    const kind = input.kind ?? "existing";
    // Both kinds start waiting for HR (2026-10-23): a request goes on to finance once approved; a record of something
    // already bought becomes what it was entered as — ordered or received — and never goes to finance.
    const boughtStatus = kind === "existing" ? (input.status === "received" ? "received" : "ordered") : null;

    const record = await Procurement.create({
      ...input,
      kind,
      status: "requested",
      boughtStatus,
      department: input.department || null,
      organization: getOrgId(),
      requestedBy,
    });

    // Both kinds wait for HR now, so both tell who can approve (once, in this block).
    {
      // The approvers (and the requester's department head) as before, plus
      // office keeping's people — in-app, and push through notify().
      const [approvers, facilities] = await Promise.all([
        watchersFor("procurement", requestedBy),
        this.facilitiesOnly(),
      ]);
      await notify({
        // Not the one who raised it: they can't approve it (2026-10-23).
        users: [...approvers, ...facilities].filter((id) => String(id) !== String(requestedBy)),
        kind: "approval",
        title: kind === "existing" ? `${input.item} recorded as bought — to approve` : `${input.item} requested`,
        body: `${input.quantity ?? 1} × ${input.item}`,
        href: "/assets",
        actor: requestedBy,
      });

      const raiser = await User.findById(requestedBy).select("name").lean<{ name?: string } | null>();
      sendWhatsAppToUsers(
        await this.facilitiesPeople(requestedBy),
        kind === "existing"
          ? `Bought item to approve: ${input.quantity ?? 1} × ${input.item}, recorded by ${raiser?.name ?? "somebody"}.`
          : `New procurement request: ${input.quantity ?? 1} × ${input.item}, raised by ${raiser?.name ?? "somebody"}.`
      ).catch(() => null);
    }
    const created = await Procurement.findById(record._id).populate(POP);
    return shape(created!.toObject());
  }

  /**
   * `restrictToUserId`, when given, means the caller reached this without
   * holding `procurement.view` — a department head, let through by the route
   * on that standing alone. Their view is narrowed to the departments they
   * actually head, ignoring any `department` filter they might send: heading
   * a team is not itself the permission to browse every other one.
   */
  /** The list's filter — null when a department head heads nothing, so sees nothing. */
  private async filterFor(query: ProcurementQuery, restrictToUserId?: string, withStatus = true) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.item = searchRegex(query.search);
    if (withStatus && query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.kind) filter.kind = query.kind;
    if (query.category) filter.category = query.category;
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from && !Number.isNaN(Date.parse(query.from))) range.$gte = new Date(`${query.from.slice(0, 10)}T00:00:00Z`);
      if (query.to && !Number.isNaN(Date.parse(query.to))) range.$lt = new Date(new Date(`${query.to.slice(0, 10)}T00:00:00Z`).getTime() + 86_400_000);
      if (Object.keys(range).length) filter.createdAt = range;
    }

    if (restrictToUserId) {
      const heads = await departmentsHeadedBy(restrictToUserId);
      if (!heads.length) return null;
      filter.department = { $in: heads };
    } else if (query.department) {
      filter.department = query.department;
    }
    return filter;
  }

  async list(query: ProcurementQuery, restrictToUserId?: string) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter = await this.filterFor(query, restrictToUserId);
    if (!filter) return { records: [], pagination: buildPagination(0, page, limit) };

    const sortable = new Set(["item", "quantity", "estimatedCost", "neededBy", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Procurement.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Procurement.countDocuments(filter),
    ]);
    return { records: records.map((r) => shape(r)), pagination: buildPagination(total, page, limit) };
  }

  /**
   * How many in each status, and what they are estimated to cost (2026-10-23) — the Procurement tab's totals. Same
   * filters and narrowing as `list`, but every status, so each total shows whichever status is picked.
   */
  async summary(query: ProcurementQuery, restrictToUserId?: string) {
    const filter = await this.filterFor(query, restrictToUserId, false);
    if (!filter) return { total: 0, byStatus: [] };
    const rows = await Procurement.aggregate([
      { $match: filter },
      { $group: { _id: { status: "$status", currency: "$currency" }, count: { $sum: 1 }, estimatedCost: { $sum: "$estimatedCost" } } },
    ]);
    type Total = { status: string; count: number; costs: { currency: string; amount: number }[] };
    const byStatus = new Map<string, Total>();
    for (const r of rows) {
      const s: Total = byStatus.get(r._id.status) ?? { status: r._id.status, count: 0, costs: [] };
      s.count += r.count;
      if (r.estimatedCost) s.costs.push({ currency: r._id.currency || "AED", amount: Math.round(r.estimatedCost * 100) / 100 });
      byStatus.set(r._id.status, s);
    }
    return { total: [...byStatus.values()].reduce((n, s) => n + s.count, 0), byStatus: [...byStatus.values()] };
  }

  /** Same narrowing as `list` — a department head asking for one by id gets
   *  it only when it is theirs to see, not anybody's for the guessing. */
  async getById(id: string, restrictToUserId?: string) {
    const record = await Procurement.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (restrictToUserId) {
      // `department` arrives populated (POP), not a bare id — comparing the
      // raw value against `heads` would refuse every request, including the
      // caller's own.
      const deptId = record.department && typeof record.department === "object"
        ? String((record.department as { _id: unknown })._id)
        : String(record.department ?? "");
      const heads = await departmentsHeadedBy(restrictToUserId);
      if (!deptId || !heads.includes(deptId)) {
        throw Object.assign(new Error("That request is not from your department"), { statusCode: 403 });
      }
    }
    return shape(record.toObject());
  }

  /** Attach a report file, or replace the one already there. */
  async setReport(id: string, key: string, fileName: string) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (record.reportKey) await deleteObject(record.reportKey);
    record.reportKey = key;
    record.reportFileName = fileName;
    await record.save();
    const updated = await Procurement.findById(id).populate(POP);
    return shape(updated!.toObject());
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
    // The approval states are reached by deciding, never by editing (2026-10-23): a record waiting for HR stays
    // waiting, and nothing is edited into or out of approval. A bought record waiting keeps what it will become.
    const patch: Record<string, unknown> = { ...input };
    if (input.status !== undefined && input.status !== record.status) {
      const inApproval = (s: string) => (APPROVAL_STATES as readonly string[]).includes(s);
      if (inApproval(record.status) || inApproval(input.status)) {
        if (record.kind === "existing" && record.status === "requested" && (input.status === "ordered" || input.status === "received")) {
          patch.boughtStatus = input.status;
          delete patch.status;
        } else {
          throw Object.assign(new Error("Its status changes by approving it, not by editing it"), { statusCode: 409 });
        }
      }
    } else if (input.status === record.status) {
      delete patch.status;
    }
    if (input.department !== undefined) patch.department = input.department || null;
    // The kind decides which states are legal, so it is not a field an edit
    // may flip — a record halfway through approval cannot become history.
    delete patch.kind;

    await Procurement.updateOne({ _id: record._id }, { $set: patch });
    const updated = await Procurement.findById(record._id).populate(POP);
    return shape(updated!.toObject());
  }

  /**
   * HR's decision: a request approved on to finance, or a bought record approved as bought — or either refused here.
   * Never by the one who raised it (2026-10-23: "another member needs to approve" — nobody, whatever their role).
   */
  async review(id: string, input: ReviewProcurementInput, reviewerId: string) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (record.status !== "requested") {
      throw Object.assign(new Error("This request has already been decided"), { statusCode: 400 });
    }
    if (record.requestedBy && String(record.requestedBy) === String(reviewerId)) {
      throw Object.assign(new Error("You raised this — another member has to approve or reject it"), { statusCode: 403 });
    }

    const approved = input.decision === "approve";
    const bought = record.kind === "existing";
    await Procurement.updateOne({ _id: record._id }, {
      $set: {
        status: approved ? (bought ? record.boughtStatus || "ordered" : "hr_approved") : "rejected",
        hrReviewedBy: reviewerId,
        hrReviewedAt: new Date(),
        hrNote: input.note ?? "",
        rejectedBy: approved ? null : "hr",
      },
    });

    const hrHeadline = approved
      ? bought ? "has been approved by HR" : "has been approved by HR and sent to finance"
      : "was not approved by HR";
    await this.tellRequester(record as never, hrHeadline, input.note);
    await this.tellApprovers(record as never, hrHeadline, input.note, reviewerId);
    const reviewed = await Procurement.findById(record._id).populate(POP);
    return shape(reviewed!.toObject());
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
    const resubmitted = await Procurement.findById(record._id).populate(POP);
    return shape(resubmitted!.toObject());
  }

  async remove(id: string) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    if (record.reportKey) await deleteObject(record.reportKey);
    await Procurement.deleteOne({ _id: record._id });
    return { message: "Procurement deleted successfully" };
  }

  // ── Finance integration ────────────────────────────────────────────────────
  // Called from signed machine requests, which carry the organization
  // explicitly because there is no logged-in user to infer it from.

  /** What is sitting with finance, waiting on the money decision. */
  async listForFinance(organization: string, status: FinanceProcurementStatus = "hr_approved") {
    if (status === "hr_approved") {
      const records = await Procurement.find({ organization, kind: "new", status: "hr_approved" })
        .populate(POP)
        .sort({ neededBy: 1, createdAt: 1 })
        .lean();
      return records.map((r) => shape(r));
    }
    const filter = status === "all" ? { organization } : { organization, status };
    const records = await Procurement.find(filter).populate(POP).sort({ createdAt: -1 }).limit(1000).lean();
    return records.map((r) => shape(r));
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

    // Finance is waiting on this answer, and the post can take a while — a mail
    // to each approver in turn, through the organization's SMTP. Waiting for it
    // ran finance past its timeout: it reported a failure for a decision that
    // had been recorded here. So the decision is answered now and announced
    // straight after; it is saved either way, and the post never decided it.
    this.announceFinanceDecision(record as never, approved, input).catch((err) =>
      console.error(`procurement: could not announce finance's decision on ${record._id}:`, err instanceof Error ? err.message : err)
    );

    return shape(await Procurement.findById(record._id).populate(POP).lean());
  }

  /** Who hears what finance decided — everything `recordFinanceDecision` no longer waits for. */
  private async announceFinanceDecision(
    record: { _id: unknown; item: string; quantity?: number; requestedBy?: unknown; status: string },
    approved: boolean,
    input: { note?: string | null; purchaseOrderRef?: string | null }
  ) {
    const financeHeadline = approved ? "has been approved by finance" : "was not approved by finance";
    await this.tellRequester(record, financeHeadline, input.note);
    // The decision was made in the finance system, so there is no HRMS user to
    // leave out — everybody who approves these hears about it.
    await this.tellApprovers(record, financeHeadline, input.note);

    // Approved is the moment somebody actually goes and buys it — so office
    // keeping's people hear too (mail, in-app, push), and everyone gets it on
    // WhatsApp. A refusal is only procurement's business, and stops above.
    if (approved) {
      await this.tellApprovers(record, financeHeadline, input.note, undefined, await this.facilitiesOnly());
      const ref = input.purchaseOrderRef ? ` (${input.purchaseOrderRef})` : "";
      await sendWhatsAppToUsers(
        await this.facilitiesPeople(record.requestedBy),
        `Procurement approved by finance: ${record.quantity ?? 1} × ${record.item}${ref}. Ready to purchase.`
      );
    }
  }
}
