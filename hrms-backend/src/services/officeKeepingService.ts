import { OfficeKeepingRequest } from "../models/OfficeKeepingRequest.js";
import { User } from "../models/User.js";
import type { CreateOfficeKeepingInput, UpdateStatusInput } from "../validations/officeKeepingValidation.js";
import type { OfficeKeepingStatus, PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { putObject, publicUrl } from "./uploadService.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { env } from "../config/env.js";

const POP = [
  { path: "requestedBy", select: "name email" },
  { path: "handledBy", select: "name email" },
];

const WORDS: Record<OfficeKeepingStatus, string> = {
  requested: "has been raised",
  arriving: "is being seen to — somebody is on their way",
  sorted: "has been sorted",
  cancelled: "has been cancelled",
};

interface Query extends PaginationQuery {
  status?: string;
}

export class OfficeKeepingService {
  /** A stored key is useless to a browser; the row carries the address instead. */
  private shape<T extends { photoKey?: string }>(row: T) {
    const { photoKey, ...rest } = row as T & Record<string, unknown>;
    return { ...rest, photoUrl: photoKey ? publicUrl(String(photoKey)) : "" };
  }

  /**
   * Whoever runs office keeping.
   *
   * Read from the permission rather than a name, so the request reaches the
   * person doing the job today — not an employee id written into the code the
   * week somebody happened to be doing it.
   */
  private async handlers(): Promise<Array<{ id: string; name: string; email: string }>> {
    const ids = await watchersFor("officeKeeping");
    if (!ids.length) return [];
    const users = await User.find({ _id: { $in: ids }, status: { $ne: "inactive" } }).select("name email").lean();
    return users
      .filter((u) => !!u.email)
      .map((u) => ({ id: String(u._id), name: String(u.name ?? "there"), email: String(u.email) }));
  }

  private async mail(to: string, subject: string, heading: string, body: string) {
    try {
      await sendMail({
        to,
        organization: String(getOrgId() ?? ""),
        subject,
        text: `${heading}\n\n${body.replace(/<[^>]+>/g, "")}\n\n${env.CLIENT_URL}/office-keeping\n`,
        html:
          `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
          `<h2 style="color:#4f46e5;margin-bottom:4px">${heading}</h2><p style="color:#555">${body}</p>` +
          `<p><a href="${env.CLIENT_URL}/office-keeping" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open office keeping</a></p>` +
          `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
      });
    } catch {
      /* the request stands whether or not the mail got out */
    }
  }

  async create(input: CreateOfficeKeepingInput, requestedBy: string, file?: Express.Multer.File) {
    let photoKey = "";
    if (file) {
      // A failed upload must not lose the report — the words are the part that
      // matters, and a picture nobody can see is not worth refusing them over.
      try {
        const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
        const key = `${String(getOrgId() ?? "global")}/office-keeping/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        await putObject(key, file.buffer, file.mimetype);
        photoKey = key;
      } catch {
        photoKey = "";
      }
    }

    const record = await OfficeKeepingRequest.create({
      ...input,
      organization: getOrgId(),
      requestedBy,
      photoKey,
      history: [{ status: "requested", at: new Date(), by: requestedBy }],
    });

    const raisedBy = await User.findById(requestedBy).select("name").lean<{ name?: string } | null>();
    const who = raisedBy?.name ?? "Somebody";
    const people = await this.handlers();
    if (people.length) {
      await notify({
        users: people.map((p) => p.id),
        kind: "system",
        title: `Office keeping: ${input.location}`,
        body: `${who} — ${input.issue.slice(0, 120)}`,
        href: "/office-keeping",
        actor: requestedBy,
      });
      for (const p of people) {
        await this.mail(
          p.email,
          `Office keeping asked for — ${input.location}`,
          "Something needs seeing to",
          `<strong>${who}</strong> has raised a request at <strong>${input.location}</strong>.<br>${input.issue}` +
            (photoKey ? "<br><br>A photo is attached to the request." : "")
        );
      }
    }

    return this.shape((await OfficeKeepingRequest.findById(record._id).populate(POP).lean())!);
  }

  /** The requester's own, whatever their permissions. */
  async listMine(userId: string, query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter(), requestedBy: userId };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;

    const [records, total] = await Promise.all([
      OfficeKeepingRequest.find(filter).populate(POP).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      OfficeKeepingRequest.countDocuments(filter),
    ]);
    return { records: records.map((r) => this.shape(r)), pagination: buildPagination(total, page, limit) };
  }

  /** The panel: everything, for whoever runs office keeping. */
  async list(query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;

    const [records, total] = await Promise.all([
      // Still-open work first, and oldest first inside that — the thing waiting
      // longest is the thing most likely to have been forgotten.
      OfficeKeepingRequest.find(filter).populate(POP).sort({ status: 1, createdAt: 1 }).skip(skip).limit(limit).lean(),
      OfficeKeepingRequest.countDocuments(filter),
    ]);
    return { records: records.map((r) => this.shape(r)), pagination: buildPagination(total, page, limit) };
  }

  async updateStatus(id: string, input: UpdateStatusInput, actorId: string) {
    const record = await OfficeKeepingRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    if (record.status === "sorted" || record.status === "cancelled") {
      throw Object.assign(new Error("This request is already closed"), { statusCode: 400 });
    }
    if (record.status === input.status) {
      throw Object.assign(new Error(`It is already marked ${input.status}`), { statusCode: 400 });
    }

    await OfficeKeepingRequest.updateOne({ _id: record._id }, {
      $set: { status: input.status, handledBy: actorId },
      $push: { history: { status: input.status, at: new Date(), by: actorId, note: input.note ?? "" } },
    });

    // The person who raised it is the one waiting on the answer.
    const requester = await User.findById(record.requestedBy).select("name email").lean<{ name?: string; email?: string } | null>();
    if (requester) {
      try {
        await notify({
          users: [String(record.requestedBy)],
          kind: "system",
          title: `Office keeping ${input.status}: ${record.location}`,
          body: input.note ?? record.issue.slice(0, 120),
          href: "/office-keeping",
          actor: actorId,
        });
      } catch {
        /* the mail below is the part that matters */
      }
      if (requester.email) {
        await this.mail(
          requester.email,
          `Your office keeping request ${WORDS[input.status]}`,
          `Your request ${WORDS[input.status]}`,
          `<strong>${record.location}</strong> — ${record.issue}` + (input.note ? `<br><br>${input.note}` : "")
        );
      }
    }

    return this.shape((await OfficeKeepingRequest.findById(record._id).populate(POP).lean())!);
  }

  /** The requester withdrawing their own, before anybody has set off. */
  async cancelMine(id: string, userId: string) {
    const record = await OfficeKeepingRequest.findOne(scoped({ _id: id, requestedBy: userId }));
    if (!record) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    if (record.status !== "requested") {
      throw Object.assign(new Error("Somebody is already dealing with this — ask them to close it"), { statusCode: 400 });
    }
    await OfficeKeepingRequest.updateOne({ _id: record._id }, {
      $set: { status: "cancelled" },
      $push: { history: { status: "cancelled", at: new Date(), by: userId, note: "Withdrawn by the requester" } },
    });
    return { message: "Request withdrawn" };
  }
}
