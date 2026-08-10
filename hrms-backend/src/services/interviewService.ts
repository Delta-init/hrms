import { Interview } from "../models/Interview.js";
import { InterviewFeedback } from "../models/InterviewFeedback.js";
import { Application } from "../models/Application.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { sendMail } from "../utils/mailer.js";
import { inviteAttachment } from "../utils/calendarInvite.js";
import { env } from "../config/env.js";
import type {
  ScheduleInterviewInput, UpdateInterviewInput, FeedbackInput,
} from "../validations/interviewValidation.js";

/**
 * Scheduling interviews, and collecting what the panel thought.
 *
 * Invites go out as an `.ics` attachment rather than through a calendar API —
 * see utils/calendarInvite.ts for why. The consequence worth knowing is that
 * free/busy is invisible here, so a clash is only detected against interviews
 * this system scheduled.
 */

class InterviewError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const POP = [
  { path: "panel", select: "name email" },
  { path: "createdBy", select: "name email" },
  {
    path: "application",
    select: "candidate requisition stage status",
    populate: [
      { path: "candidate", select: "name email phone" },
      { path: "requisition", select: "title" },
    ],
  },
];

const MODE_LABELS: Record<string, string> = { in_person: "In person", video: "Video call", phone: "Phone" };

const fmt = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short",
  }).format(d);

/**
 * Panel members already booked across a window.
 *
 * Only against interviews this system knows about — an `.ics` invite cannot ask
 * a calendar what else is on it. Better than nothing, and honest about which.
 */
export async function panelConflicts(
  panel: string[],
  start: Date,
  durationMinutes: number,
  excludeInterviewId?: string
): Promise<Array<{ user: string; name: string; clashesWith: string; at: Date }>> {
  if (!panel.length) return [];
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const filter: Record<string, unknown> = {
    ...orgFilter(),
    status: "scheduled",
    panel: { $in: panel },
    // Anything starting before this one ends; the overlap check narrows it below.
    scheduledAt: { $lt: end, $gte: new Date(start.getTime() - 12 * 3600_000) },
  };
  if (excludeInterviewId) filter._id = { $ne: excludeInterviewId };

  const near = await Interview.find(filter)
    .populate<{ panel: Array<{ _id: unknown; name: string }> }>("panel", "name")
    .populate<{ application: { candidate?: { name?: string } } }>({
      path: "application", select: "candidate", populate: { path: "candidate", select: "name" },
    })
    .lean();

  const out: Array<{ user: string; name: string; clashesWith: string; at: Date }> = [];
  for (const other of near) {
    const otherEnd = new Date(new Date(other.scheduledAt).getTime() + (other.durationMinutes ?? 60) * 60_000);
    if (otherEnd <= start) continue; // ends before this one starts
    for (const p of other.panel ?? []) {
      if (!panel.includes(String(p._id))) continue;
      out.push({
        user: String(p._id),
        name: p.name,
        clashesWith: (other.application as { candidate?: { name?: string } })?.candidate?.name ?? "another interview",
        at: other.scheduledAt,
      });
    }
  }
  return out;
}

export class InterviewService {
  /** Email the panel and the candidate, with the invite attached. */
  private async notify(interviewId: string, cancelled = false) {
    const doc = await Interview.findById(interviewId).populate(POP).lean();
    if (!doc) return;

    const app = doc.application as unknown as { candidate?: { name?: string; email?: string }; requisition?: { title?: string } };
    const panel = (doc.panel ?? []) as unknown as Array<{ name?: string; email?: string }>;
    const org = await Organization.findById(getOrgId()).select("name").lean<{ name?: string } | null>();

    const role = app?.requisition?.title ?? "a role";
    const who = app?.candidate?.name ?? "a candidate";
    const when = fmt(new Date(doc.scheduledAt), doc.timeZone);
    const where = doc.mode === "in_person" ? doc.location : doc.meetingLink;

    const event = {
      // Stable across re-sends, so a reschedule updates the calendar entry
      // instead of leaving the old one sitting there beside it.
      uid: `interview-${doc._id}@delta-hrms`,
      sequence: doc.inviteSequence ?? 0,
      start: new Date(doc.scheduledAt),
      durationMinutes: doc.durationMinutes ?? 60,
      summary: `${cancelled ? "Cancelled: " : ""}Interview — ${who} (${role})`,
      description: [`Round ${doc.round}`, MODE_LABELS[doc.mode] ?? doc.mode, where].filter(Boolean).join(" · "),
      location: where ?? undefined,
      organizer: { name: org?.name ?? "Delta HRMS", email: env.SMTP_USER ?? "no-reply@localhost" },
      attendees: panel.filter((p) => p.email).map((p) => ({ name: p.name, email: p.email! })),
      cancelled,
    };

    const rows = [
      ["Candidate", who],
      ["Role", role],
      ["Round", String(doc.round)],
      ["When", when],
      ["How", MODE_LABELS[doc.mode] ?? doc.mode],
      ...(where ? [[doc.mode === "in_person" ? "Where" : "Link", where]] : []),
      ["Panel", panel.map((p) => p.name).filter(Boolean).join(", ") || "—"],
    ];
    const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:${cancelled ? "#dc2626" : "#4f46e5"};margin-bottom:4px">${cancelled ? "Interview cancelled" : "Interview scheduled"}</h2>
      <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`).join("")}
      </table>
      <p style="color:#999;font-size:12px">Sent automatically by Delta HRMS.</p>
    </div>`;

    const to = panel.map((p) => p.email).filter(Boolean) as string[];
    if (app?.candidate?.email) to.push(app.candidate.email);
    if (!to.length) return;

    // Never lets a scheduling call fail because SMTP is down — the interview is
    // already saved, and a missing email is recoverable by re-sending.
    try {
      await sendMail({ to, subject: `${cancelled ? "Cancelled: " : ""}Interview — ${who}, ${role}`, html, attachments: [inviteAttachment(event)] });
    } catch (err) {
      console.error("✉️  interview invite failed:", err instanceof Error ? err.message : err);
    }
  }

  async schedule(input: ScheduleInterviewInput, by: string) {
    const app = await Application.findOne(scoped({ _id: input.application })).select("status stage").lean();
    if (!app) throw new InterviewError("Application not found", 404);
    if (app.status !== "active") {
      throw new InterviewError(`This application was already ${app.status}; there is nobody to interview`);
    }

    const panel = input.panel ?? [];
    const known = await User.countDocuments(scoped({ _id: { $in: panel } }));
    if (known !== panel.length) throw new InterviewError("One of the panel members was not found");

    const doc = await Interview.create({
      ...input,
      organization: getOrgId(),
      createdBy: by,
      inviteSequence: 0,
    });

    // Moved on arrival: scheduling one is what "at interview" means, and asking
    // somebody to also drag the card is a step they will forget.
    if (app.stage !== "interview") {
      await Application.updateOne(scoped({ _id: input.application }), { $set: { stage: "interview" } });
    }

    await this.notify(String(doc._id));
    return Interview.findById(doc._id).populate(POP);
  }

  async list(query: PaginationQuery & { application?: string; from?: string; to?: string; panellist?: string }) {
    const { page, limit, skip } = parsePagination(query, 50, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.application) filter.application = query.application;
    if (query.status) filter.status = query.status;
    if (query.panellist) filter.panel = query.panellist;
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) range.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);
      filter.scheduledAt = range;
    }

    const [records, total] = await Promise.all([
      Interview.find(filter).populate(POP).sort({ scheduledAt: 1 }).skip(skip).limit(limit).lean(),
      Interview.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** One interview with every verdict submitted against it. */
  async getById(id: string) {
    const record = await Interview.findOne(scoped({ _id: id })).populate(POP).lean();
    if (!record) throw new InterviewError("Interview not found", 404);
    const feedback = await InterviewFeedback.find(scoped({ interview: id }))
      .populate({ path: "panellist", select: "name email" })
      .sort({ submittedAt: 1 })
      .lean();
    return { ...record, feedback };
  }

  async update(id: string, input: UpdateInterviewInput) {
    const record = await Interview.findOne(scoped({ _id: id }));
    if (!record) throw new InterviewError("Interview not found", 404);
    if (record.status === "cancelled") throw new InterviewError("This interview was cancelled");

    // Only a change to the appointment itself is worth re-sending; adding a
    // recording link afterwards should not ping five calendars.
    const rescheduled =
      (input.scheduledAt && new Date(input.scheduledAt).getTime() !== record.scheduledAt.getTime()) ||
      (input.durationMinutes && input.durationMinutes !== record.durationMinutes) ||
      (input.panel && input.panel.join() !== record.panel.map(String).join()) ||
      (input.location && input.location !== record.location) ||
      (input.meetingLink && input.meetingLink !== record.meetingLink);

    Object.assign(record, input);
    if (rescheduled) record.inviteSequence = (record.inviteSequence ?? 0) + 1;
    await record.save();

    if (rescheduled) await this.notify(id);
    return Interview.findById(id).populate(POP);
  }

  async cancel(id: string) {
    const record = await Interview.findOne(scoped({ _id: id }));
    if (!record) throw new InterviewError("Interview not found", 404);
    if (record.status === "cancelled") return Interview.findById(id).populate(POP);

    record.status = "cancelled";
    record.inviteSequence = (record.inviteSequence ?? 0) + 1;
    await record.save();
    // Withdraws the calendar entry rather than leaving it sitting there.
    await this.notify(id, true);
    return Interview.findById(id).populate(POP);
  }

  /** Clash check, run before saving so the form can warn rather than refuse. */
  async conflicts(panel: string[], scheduledAt: string, durationMinutes: number, exclude?: string) {
    return panelConflicts(panel, new Date(scheduledAt), durationMinutes, exclude);
  }

  // ── Feedback ───────────────────────────────────────────────────────────────

  /** Record, or revise, one panellist's verdict. */
  async submitFeedback(interviewId: string, input: FeedbackInput, panellist: string) {
    const interview = await Interview.findOne(scoped({ _id: interviewId })).select("panel status").lean();
    if (!interview) throw new InterviewError("Interview not found", 404);
    if (interview.status === "cancelled") throw new InterviewError("This interview was cancelled");

    const onPanel = (interview.panel ?? []).some((p) => String(p) === panellist);
    if (!onPanel) throw new InterviewError("Only the panel can leave feedback on this interview", 403);

    const doc = await InterviewFeedback.findOneAndUpdate(
      scoped({ interview: interviewId, panellist }),
      { $set: { ...input, submittedAt: new Date() }, $setOnInsert: { organization: getOrgId(), interview: interviewId, panellist } },
      { new: true, upsert: true }
    ).populate({ path: "panellist", select: "name email" });

    return doc;
  }

  async removeFeedback(id: string, panellist: string) {
    const record = await InterviewFeedback.findOneAndDelete(scoped({ _id: id, panellist }));
    if (!record) throw new InterviewError("Feedback not found, or it is not yours to remove", 404);
    return { message: "Feedback removed" };
  }

  async remove(id: string) {
    const record = await Interview.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw new InterviewError("Interview not found", 404);
    await InterviewFeedback.deleteMany(scoped({ interview: id }));
    return { message: "Interview deleted" };
  }
}
