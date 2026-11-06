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
import { notify } from "./notificationService.js";
import { publicUrl } from "./uploadService.js";
import { answersFor, badMarks, sheetTotals, unanswered, type SheetQuestion } from "../utils/interviewMarks.js";
import type {
  ScheduleInterviewInput, UpdateInterviewInput, FeedbackInput, SheetInput,
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

/**
 * Why a sheet can no longer change, or null while it still can.
 *
 * The marks are what an offer is decided on, so they freeze once one is in
 * motion — a mark revised after the offer would rewrite the reason for it.
 */
function lockedBecause(app: {
  movedToEmployee?: unknown; offer?: { sentAt?: Date | null } | null; offerApproval?: { status?: string } | null;
} | null): string | null {
  if (!app) return null;
  if (app.movedToEmployee) return "The candidate has been hired";
  if (app.offer?.sentAt) return "An offer has been sent to the candidate";
  if (app.offerApproval?.status === "pending" || app.offerApproval?.status === "approved") return "An offer has been requested for the candidate";
  return null;
}

type SheetDoc = {
  _id: unknown; status?: string; recommendation?: string | null; notes?: string;
  answers?: Array<{ questionId: unknown; question: string; expectedAnswer: string; maxMarks: number; response: string; marks: number | null }>;
  totalMarks?: number | null; maxTotal?: number | null; submittedAt?: Date | null; updatedAt?: Date;
  panellist?: unknown;
};

/** A sheet as the pages read it. A row from before drafts existed was submitted. */
const shapeSheet = (s: SheetDoc) => ({
  _id: s._id,
  status: s.status === "draft" ? "draft" : "submitted",
  recommendation: s.recommendation ?? null,
  notes: s.notes ?? "",
  answers: (s.answers ?? []).map((a) => ({ ...a, questionId: String(a.questionId) })),
  totalMarks: s.totalMarks ?? null,
  maxTotal: s.maxTotal ?? null,
  percent: s.maxTotal ? Math.round(((s.totalMarks ?? 0) / s.maxTotal) * 100) : null,
  submittedAt: s.submittedAt ?? null,
  updatedAt: s.updatedAt ?? null,
});

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
    await this.tellPanel(String(doc._id), panel, by);
    return Interview.findById(doc._id).populate(POP);
  }

  /**
   * Tell panellists in-app that they have a sheet to fill in. Not in the
   * emailed invite: that one goes to the candidate as well.
   */
  private async tellPanel(interviewId: string, users: string[], actor: string) {
    if (!users.length) return;
    const doc = await Interview.findById(interviewId).populate(POP).lean();
    if (!doc) return;
    const app = doc.application as unknown as { candidate?: { name?: string }; requisition?: { title?: string } };
    await notify({
      users,
      kind: "reminder",
      title: `Interview: ${app?.candidate?.name ?? "a candidate"} — ${app?.requisition?.title ?? "a role"}`,
      body: `Round ${doc.round}, ${fmt(new Date(doc.scheduledAt), doc.timeZone)}. Your interview sheet has the questions to ask and where to mark the answers.`,
      href: `/my-interviews/${interviewId}`,
      actor,
    });
  }

  async list(query: PaginationQuery & { application?: string; requisition?: string; from?: string; to?: string; panellist?: string }) {
    const { page, limit, skip } = parsePagination(query, 50, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.application) filter.application = query.application;
    // An interview points at an application, not a requisition directly — the
    // Meetings tab asks for a role, so it is resolved through the applications
    // raised against it first.
    if (query.requisition) {
      const applications = await Application.find(scoped({ requisition: query.requisition })).select("_id").lean();
      filter.application = { $in: applications.map((a) => a._id) };
    }
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
    // A draft is the panellist's own until they submit it.
    const feedback = await InterviewFeedback.find(scoped({ interview: id, status: { $ne: "draft" } }))
      .populate({ path: "panellist", select: "name email" })
      .sort({ submittedAt: 1 })
      .lean();
    return { ...record, feedback };
  }

  async update(id: string, input: UpdateInterviewInput, by?: string) {
    const record = await Interview.findOne(scoped({ _id: id }));
    if (!record) throw new InterviewError("Interview not found", 404);
    if (record.status === "cancelled") throw new InterviewError("This interview was cancelled");
    const before = new Set(record.panel.map(String));
    const joined = (input.panel ?? []).filter((p) => !before.has(String(p)));

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
    await this.tellPanel(id, joined, by ?? "");
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
    const interview = await Interview.findOne(scoped({ _id: interviewId })).select("panel status application").lean();
    if (!interview) throw new InterviewError("Interview not found", 404);
    if (interview.status === "cancelled") throw new InterviewError("This interview was cancelled");

    const onPanel = (interview.panel ?? []).some((p) => String(p) === panellist);
    if (!onPanel) throw new InterviewError("Only the panel can leave feedback on this interview", 403);

    // A verdict without the marks would skip the role's questions entirely.
    const app = await Application.findOne(scoped({ _id: (interview as { application?: unknown }).application }))
      .populate<{ requisition: { interviewQuestions?: unknown[] } | null }>({ path: "requisition", select: "interviewQuestions" })
      .select("requisition").lean();
    if (app?.requisition?.interviewQuestions?.length) {
      throw new InterviewError("This role has interview questions — fill in the interview sheet under My Interviews");
    }

    const doc = await InterviewFeedback.findOneAndUpdate(
      scoped({ interview: interviewId, panellist }),
      { $set: { ...input, status: "submitted", submittedAt: new Date() }, $setOnInsert: { organization: getOrgId(), interview: interviewId, panellist } },
      { new: true, upsert: true }
    ).populate({ path: "panellist", select: "name email" });

    return doc;
  }

  async removeFeedback(id: string, panellist: string) {
    const record = await InterviewFeedback.findOneAndDelete(scoped({ _id: id, panellist }));
    if (!record) throw new InterviewError("Feedback not found, or it is not yours to remove", 404);
    return { message: "Feedback removed" };
  }

  // ── The panellist's sheet ──────────────────────────────────────────────────
  // Reached by being on the panel, not by holding a hiring permission: the
  // people who interview are mostly not the people who run hiring.

  /** The interview with what its sheet needs, refused to anybody not on its panel. */
  private async forPanellist(interviewId: string, userId: string) {
    const interview = await Interview.findOne(scoped({ _id: interviewId }))
      .populate({ path: "panel", select: "name" })
      .populate({
        path: "application",
        select: "candidate requisition offerApproval offer movedToEmployee",
        populate: [
          { path: "candidate", select: "name resumeKey resumeFileName" },
          { path: "requisition", select: "title interviewQuestions" },
        ],
      })
      .lean();
    if (!interview) throw new InterviewError("Interview not found", 404);
    const panel = (interview.panel ?? []) as unknown as Array<{ _id: unknown; name?: string }>;
    if (!panel.some((p) => String(p._id) === String(userId))) {
      throw new InterviewError("Only the interview panel can open this sheet", 403);
    }
    const app = interview.application as unknown as {
      _id: unknown; movedToEmployee?: unknown; offer?: { sentAt?: Date | null }; offerApproval?: { status?: string };
      candidate?: { _id: unknown; name?: string; resumeKey?: string; resumeFileName?: string } | null;
      requisition?: { _id: unknown; title?: string; interviewQuestions?: SheetQuestion[] } | null;
    } | null;
    const locked = interview.status === "cancelled" ? "This interview was cancelled"
      : interview.status === "no_show" ? "The candidate did not attend"
      : lockedBecause(app);
    return { interview, panel, app, questions: app?.requisition?.interviewQuestions ?? [], locked };
  }

  /** The interviews this person sits on, with how far their own sheet has got. */
  async myInterviews(userId: string) {
    const rows = await Interview.find(scoped({ panel: userId, status: { $ne: "cancelled" } }))
      .select("application round title mode scheduledAt durationMinutes timeZone status meetingLink location")
      .populate({
        path: "application",
        select: "candidate requisition",
        populate: [{ path: "candidate", select: "name" }, { path: "requisition", select: "title interviewQuestions" }],
      })
      .sort({ scheduledAt: -1 })
      .limit(200)
      .lean();
    const sheets = await InterviewFeedback.find(scoped({ panellist: userId, interview: { $in: rows.map((r) => r._id) } })).lean();
    return rows.map((iv) => {
      const app = iv.application as unknown as { candidate?: { name?: string }; requisition?: { title?: string; interviewQuestions?: unknown[] } } | null;
      const mine = sheets.find((s) => String(s.interview) === String(iv._id));
      return {
        _id: iv._id, round: iv.round, title: iv.title, mode: iv.mode, scheduledAt: iv.scheduledAt,
        durationMinutes: iv.durationMinutes, timeZone: iv.timeZone, status: iv.status,
        meetingLink: iv.meetingLink, location: iv.location,
        candidate: { name: app?.candidate?.name ?? "—" },
        role: { title: app?.requisition?.title ?? "—" },
        questionCount: app?.requisition?.interviewQuestions?.length ?? 0,
        sheet: mine ? shapeSheet(mine as unknown as SheetDoc) : null,
      };
    });
  }

  /** One panellist's sheet: the interview, the role's questions with their expected answers, and what they have entered. */
  async sheetFor(interviewId: string, userId: string) {
    const { interview, panel, app, questions, locked } = await this.forPanellist(interviewId, userId);
    const mine = await InterviewFeedback.findOne(scoped({ interview: interviewId, panellist: userId })).lean();
    return {
      interview: {
        _id: interview._id, round: interview.round, title: interview.title, mode: interview.mode,
        scheduledAt: interview.scheduledAt, durationMinutes: interview.durationMinutes, timeZone: interview.timeZone,
        location: interview.location, meetingLink: interview.meetingLink, status: interview.status,
        panel: panel.map((p) => ({ _id: p._id, name: p.name ?? "" })),
      },
      candidate: {
        name: app?.candidate?.name ?? "—",
        // The panel interviewing them may read their CV; the link is signed and short-lived.
        resumeUrl: app?.candidate?.resumeKey ? publicUrl(app.candidate.resumeKey) : "",
        resumeFileName: app?.candidate?.resumeFileName ?? "",
      },
      role: { _id: app?.requisition?._id ?? null, title: app?.requisition?.title ?? "—" },
      questions: questions.map((q) => ({ _id: String(q._id), question: q.question, expectedAnswer: q.expectedAnswer, maxMarks: q.maxMarks })),
      sheet: mine ? shapeSheet(mine as unknown as SheetDoc) : null,
      locked,
    };
  }

  /**
   * Save the sheet as a draft, or submit it.
   *
   * A draft takes anything in range, so nothing typed during the interview is
   * lost. Submitting needs what the candidate said and the marks for every
   * question, and an overall recommendation. Once submitted it changes only by
   * submitting again — saving it back to a draft would quietly take a verdict
   * out of the results HR is reading.
   */
  async saveSheet(interviewId: string, userId: string, input: SheetInput) {
    const { questions, locked } = await this.forPanellist(interviewId, userId);
    if (locked) throw new InterviewError(`${locked}, so this sheet can no longer change`);

    const answers = answersFor(questions, input.answers);
    const bad = badMarks(answers);
    if (bad.length) throw new InterviewError(bad[0]);

    const existing = await InterviewFeedback.findOne(scoped({ interview: interviewId, panellist: userId })).select("status").lean();
    if (!input.submit && existing && existing.status !== "draft") {
      throw new InterviewError("This sheet is already submitted — submit it again to change it", 409);
    }
    if (input.submit) {
      const missing = unanswered(answers);
      if (missing.length) {
        throw new InterviewError(
          `Fill in what the candidate said and the marks for question${missing.length === 1 ? "" : "s"} ${missing.join(", ")} before submitting`
        );
      }
      if (!input.recommendation) throw new InterviewError("Give your overall recommendation before submitting");
    }

    const { totalMarks, maxTotal } = sheetTotals(answers);
    await InterviewFeedback.findOneAndUpdate(
      scoped({ interview: interviewId, panellist: userId }),
      {
        $set: {
          answers,
          recommendation: input.recommendation ?? null,
          notes: input.notes ?? "",
          totalMarks,
          maxTotal,
          status: input.submit ? "submitted" : "draft",
          submittedAt: input.submit ? new Date() : null,
        },
        $setOnInsert: { organization: getOrgId(), interview: interviewId, panellist: userId },
      },
      { upsert: true, new: true, runValidators: true }
    );
    return this.sheetFor(interviewId, userId);
  }

  /**
   * Every submitted sheet against a role's candidates — or one candidate's —
   * with who on each panel has yet to submit. Drafts stay their writer's.
   */
  async resultsFor(requisitionId: string, applicationId?: string) {
    const apps = await Application.find(scoped({ requisition: requisitionId, ...(applicationId ? { _id: applicationId } : {}) }))
      .select("candidate stage status")
      .populate({ path: "candidate", select: "name" })
      .lean();
    const interviews = await Interview.find(scoped({ application: { $in: apps.map((a) => a._id) }, status: { $ne: "cancelled" } }))
      .select("application round title scheduledAt status panel")
      .populate({ path: "panel", select: "name" })
      .sort({ scheduledAt: 1 })
      .lean();
    const sheets = await InterviewFeedback.find(scoped({ interview: { $in: interviews.map((i) => i._id) }, status: { $ne: "draft" } }))
      .populate({ path: "panellist", select: "name" })
      .sort({ submittedAt: 1 })
      .lean();

    const rows = apps.map((app) => {
      const ivs = interviews
        .filter((iv) => String(iv.application) === String(app._id))
        .map((iv) => {
          const panel = (iv.panel ?? []) as unknown as Array<{ _id: unknown; name?: string }>;
          const done = sheets
            .filter((s) => String(s.interview) === String(iv._id))
            .map((s) => {
              const p = s.panellist as unknown as { _id: unknown; name?: string } | null;
              return { ...shapeSheet(s as unknown as SheetDoc), panellist: { _id: p?._id ?? null, name: p?.name ?? "—" } };
            });
          const submittedBy = new Set(done.map((s) => String(s.panellist._id)));
          return {
            _id: iv._id, round: iv.round, title: iv.title, scheduledAt: iv.scheduledAt, status: iv.status,
            sheets: done,
            waitingOn: iv.status === "no_show" ? [] : panel.filter((p) => !submittedBy.has(String(p._id))).map((p) => p.name ?? "—"),
          };
        });
      const all = ivs.flatMap((iv) => iv.sheets);
      const scored = all.filter((s) => s.percent != null);
      const candidate = app.candidate as unknown as { _id: unknown; name?: string } | null;
      return {
        application: { _id: app._id, stage: app.stage, status: app.status },
        candidate: { _id: candidate?._id ?? null, name: candidate?.name ?? "—" },
        interviews: ivs,
        sheetCount: all.length,
        averagePercent: scored.length ? Math.round(scored.reduce((n, s) => n + (s.percent ?? 0), 0) / scored.length) : null,
        recommendations: all.reduce<Record<string, number>>((acc, s) => {
          if (s.recommendation) acc[s.recommendation] = (acc[s.recommendation] ?? 0) + 1;
          return acc;
        }, {}),
      };
    });
    // Best first; those not yet marked after them.
    return rows.sort((a, b) => (b.averagePercent ?? -1) - (a.averagePercent ?? -1));
  }

  async remove(id: string) {
    const record = await Interview.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw new InterviewError("Interview not found", 404);
    await InterviewFeedback.deleteMany(scoped({ interview: id }));
    return { message: "Interview deleted" };
  }
}
