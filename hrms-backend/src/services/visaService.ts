import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { VisaSubmission } from "../models/VisaSubmission.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { todayInTz } from "../utils/schedule.js";
import { dayOf, visaGate, type VisaGate } from "../utils/visaGate.js";
import { putObject, attachmentKey, publicUrl } from "./uploadService.js";
import { documentExt } from "../middleware/upload.js";
import { notify } from "./notificationService.js";

/**
 * Employees keeping their own visa on file, through a popup that will not
 * close until they have — and HR checking each one before it counts.
 */

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** The visa is a UAE one, so its days are Dubai's. */
const TZ = "Asia/Dubai";
/** Still working here: the popup is not for people on their way out of the records. */
const CURRENT = ["active", "probation", "notice_period"];
/** Furthest ahead a visa's expiry can sensibly be. */
const MAX_YEARS = 10;

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);

type EmpLite = {
  _id: Types.ObjectId; name?: string; employeeCode?: string; user?: Types.ObjectId | null; location?: string | null;
  visaNotRequired?: boolean; status?: string;
  visa?: { expiryDate?: Date | null } | null;
  documents?: { type: string; fileKey?: string; fileName?: string }[];
  department?: { name?: string } | null;
};
type SubLite = { _id: Types.ObjectId; kind: "visa" | "renewal"; status: "pending" | "approved" | "rejected"; submittedAt: Date; expiryDate?: Date | null; file: { key: string; name: string }; reviewNote?: string; reviewedAt?: Date | null };

const copyOf = (emp: EmpLite) => (emp.documents ?? []).find((d) => d.type === "visa_copy" && d.fileKey) ?? null;

function gateFor(emp: EmpLite, latest: SubLite | null, now = new Date()): VisaGate {
  return visaGate({
    location: emp.location ?? null,
    visaNotRequired: !!emp.visaNotRequired,
    expiryDay: dayOf(emp.visa?.expiryDate ?? null),
    hasCopy: !!copyOf(emp),
    latest: latest ? { kind: latest.kind, status: latest.status, submittedAt: latest.submittedAt } : null,
    today: todayInTz(TZ, now),
    now,
  });
}

const latestFor = (employeeId: Types.ObjectId) =>
  VisaSubmission.findOne({ employee: employeeId }).sort({ submittedAt: -1 }).lean<SubLite | null>();

const shapeSub = (s: SubLite | null) =>
  s ? {
    _id: String(s._id), kind: s.kind, status: s.status, submittedAt: s.submittedAt, expiryDate: s.expiryDate ?? null,
    fileName: s.file.name, reviewNote: s.reviewNote || null, reviewedAt: s.reviewedAt ?? null,
  } : null;

export class VisaService {
  // ── The employee ───────────────────────────────────────────────────────────

  private async mine(userId: string) {
    return Employee.findOne(scoped({ user: userId }))
      .select("name location visaNotRequired status visa documents")
      .lean<EmpLite | null>();
  }

  /** Whether the popup must show for this person, and why. Nothing to do for anybody without an employee record. */
  async myStatus(userId: string) {
    const emp = await this.mine(userId);
    if (!emp || !CURRENT.includes(emp.status ?? "active")) {
      return { applies: false, required: false, reason: null, pending: false, renewalUntil: null, expiryDate: null, hasCopy: false, latest: null };
    }
    const latest = await latestFor(emp._id);
    const gate = gateFor(emp, latest);
    return { ...gate, expiryDate: emp.visa?.expiryDate ?? null, hasCopy: !!copyOf(emp), latest: shapeSub(latest) };
  }

  /**
   * Send in the visa, or proof its renewal is under way. Nothing reaches the
   * employee record until HR approves; the popup steps aside meanwhile.
   */
  async submit(userId: string, input: { kind: "visa" | "renewal"; expiryDate?: string }, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
    const emp = await this.mine(userId);
    if (!emp) throw err("No employee record is linked to your account — contact HR", 400);
    const latest = await latestFor(emp._id);
    const gate = gateFor(emp, latest);
    if (!gate.applies) throw err("HR has not asked you for a visa", 400);
    if (latest?.status === "pending") throw err("Your last one is still with HR — you'll hear once it's checked", 409);

    let expiryDate: Date | null = null;
    if (input.kind === "visa") {
      const day = (input.expiryDate ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw err("Enter the visa's expiry date", 400);
      const today = todayInTz(TZ);
      if (day <= today) throw err("That date has passed — enter the expiry of your current visa, or choose “renewal in progress”", 400);
      if (Number(day.slice(0, 4)) > Number(today.slice(0, 4)) + MAX_YEARS) throw err("Check the year — that is further ahead than a visa runs", 400);
      expiryDate = new Date(`${day}T00:00:00Z`);
    } else if (gate.reason !== "expired" && gate.reason !== "returned") {
      throw err("“Renewal in progress” is for a visa that has expired — upload your current visa instead", 400);
    }

    const key = attachmentKey(getOrgId(), String(emp._id), "visa", documentExt(file.mimetype), Date.now());
    await putObject(key, file.buffer, file.mimetype);
    await VisaSubmission.create({
      organization: getOrgId(), employee: emp._id, user: userId, kind: input.kind, expiryDate,
      file: { key, name: file.originalname.slice(0, 200), contentType: file.mimetype, size: file.size },
      status: "pending", submittedAt: new Date(),
    });
    return this.myStatus(userId);
  }

  // ── HR ─────────────────────────────────────────────────────────────────────

  /** Submissions, newest first — pending ones first of all. */
  async list(status?: string) {
    const filter: Record<string, unknown> = scoped({});
    if (status && ["pending", "approved", "rejected"].includes(status)) filter.status = status;
    const rows = await VisaSubmission.find(filter)
      .sort({ submittedAt: -1 })
      .limit(500)
      .populate({ path: "employee", select: "name employeeCode department visa", populate: { path: "department", select: "name" } })
      .populate("reviewedBy", "name")
      .lean();
    const pending = await VisaSubmission.countDocuments(scoped({ status: "pending" }));
    return {
      pending,
      rows: rows
        .map((r) => {
          const e = r.employee as unknown as (EmpLite & { _id: Types.ObjectId }) | null;
          return {
            _id: String(r._id),
            kind: r.kind,
            status: r.status,
            submittedAt: r.submittedAt,
            expiryDate: r.expiryDate ?? null,
            file: { name: r.file.name, url: publicUrl(r.file.key), contentType: r.file.contentType },
            reviewNote: r.reviewNote || null,
            reviewedAt: r.reviewedAt ?? null,
            reviewedBy: (r.reviewedBy as unknown as { name?: string } | null)?.name ?? null,
            employee: e ? {
              _id: String(e._id), name: e.name ?? "—", employeeCode: e.employeeCode ?? "",
              department: e.department?.name ?? "", currentExpiry: e.visa?.expiryDate ?? null,
            } : null,
          };
        })
        .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")),
    };
  }

  /** How many wait on HR, for the sidebar badge. */
  async pendingCount() {
    return VisaSubmission.countDocuments(scoped({ status: "pending" }));
  }

  /** Dubai staff still to send theirs in — the people the popup is waiting on. */
  async outstanding() {
    const staff = await Employee.find(scoped({ location: "dubai", status: { $in: CURRENT }, user: { $ne: null } }))
      .select("name employeeCode location visaNotRequired status visa documents department user")
      .populate("department", "name")
      .sort({ name: 1 })
      .lean<EmpLite[]>();
    const latest = await VisaSubmission.aggregate<SubLite & { _id: Types.ObjectId; employee: Types.ObjectId }>([
      // By employee only: they are already this organisation's, and an
      // aggregate does not cast the org id the way find() does — matching on it
      // as a string here quietly found nothing.
      { $match: { employee: { $in: staff.map((e) => e._id) } } },
      { $sort: { submittedAt: -1 } },
      { $group: { _id: "$employee", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]);
    const byEmp = new Map(latest.map((s) => [String(s.employee), s]));
    const out = [];
    let upToDate = 0, waiting = 0, exempt = 0;
    for (const e of staff) {
      const gate = gateFor(e, byEmp.get(String(e._id)) ?? null);
      if (!gate.applies) { exempt += 1; continue; }
      if (gate.pending) { waiting += 1; continue; }
      if (!gate.required) { upToDate += 1; continue; }
      out.push({
        _id: String(e._id), name: e.name ?? "—", employeeCode: e.employeeCode ?? "", department: e.department?.name ?? "",
        reason: gate.reason, expiryDate: e.visa?.expiryDate ?? null, hasCopy: !!copyOf(e),
      });
    }
    return { counts: { total: staff.length, upToDate, waiting, outstanding: out.length, exempt }, rows: out };
  }

  /**
   * Accept a submission. A visa's expiry goes onto the record and its scan
   * becomes their visa copy, so the expiry warnings run from it; a renewal
   * starts its 30 days. Claimed atomically first, so two people approving at
   * once cannot both act on it.
   */
  async approve(id: string, reviewerId: string) {
    const sub = await VisaSubmission.findOneAndUpdate(
      scoped({ _id: id, status: "pending" }),
      { $set: { status: "approved", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: "" } },
      { new: true }
    ).lean();
    if (!sub) throw err("That one has already been decided, or is not here", 409);
    try {
      if (sub.kind === "visa") {
        const emp = await Employee.findOne(scoped({ _id: sub.employee }));
        if (!emp) throw err("Employee not found", 404);
        emp.set("visa.expiryDate", sub.expiryDate);
        // The old scan stays in storage — earlier submissions still point at
        // their own files, and nothing about a visa should vanish on approval.
        emp.documents = (emp.documents ?? []).filter((d) => d.type !== "visa_copy");
        emp.documents.push({
          type: "visa_copy", fileName: sub.file.name, fileKey: sub.file.key, mimeType: sub.file.contentType,
          size: sub.file.size, uploadedAt: new Date(), uploadedBy: "hr",
        });
        await emp.save();
      }
    } catch (e) {
      await VisaSubmission.updateOne({ _id: sub._id }, { $set: { status: "pending", reviewedBy: null, reviewedAt: null } });
      throw e;
    }
    await notify({
      users: [sub.user], kind: "approval", tone: "positive", actor: reviewerId,
      title: sub.kind === "visa" ? "Your visa is approved" : "Your visa renewal is noted",
      body: sub.kind === "visa"
        ? `HR has your visa on file, valid until ${fmtDay(sub.expiryDate!)}.`
        : `Upload the renewed visa once you have it — you'll be asked again after ${fmtDay(new Date(sub.submittedAt.getTime() + 30 * 86_400_000))}.`,
      href: "/profile",
    });
    return this.list();
  }

  /** Send it back with a reason; the popup asks them again. */
  async reject(id: string, reviewerId: string, note: string) {
    const reason = note.trim();
    if (reason.length < 3) throw err("Say what needs fixing — the employee sees this", 400);
    const sub = await VisaSubmission.findOneAndUpdate(
      scoped({ _id: id, status: "pending" }),
      { $set: { status: "rejected", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: reason.slice(0, 500) } },
      { new: true }
    ).lean();
    if (!sub) throw err("That one has already been decided, or is not here", 409);
    await notify({
      users: [sub.user], kind: "approval", tone: "negative", actor: reviewerId,
      title: "HR sent back your visa",
      body: reason.slice(0, 200),
      href: "/dashboard",
    });
    return this.list();
  }

  /** HR's switch: this person needs no UAE visa, so is never asked. */
  async setNotRequired(employeeId: string, notRequired: boolean) {
    const res = await Employee.updateOne(scoped({ _id: employeeId }), { $set: { visaNotRequired: notRequired } });
    if (!res.matchedCount) throw err("Employee not found", 404);
    return { employeeId, visaNotRequired: notRequired };
  }
}

