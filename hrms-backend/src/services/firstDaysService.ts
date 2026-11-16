import { FirstDays } from "../models/FirstDays.js";
import { TeamVideo } from "../models/TeamVideo.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { VideoView } from "../models/VideoView.js";
import { InductionVideo } from "../models/InductionVideo.js";
import { scoped, getOrgId, runWithOrg } from "../utils/orgContext.js";
import { publicUrl } from "./uploadService.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { departmentsHeadedBy, headContactsFor, headsDepartmentOf } from "./departmentHeadService.js";
import { holidayKeysFor } from "../utils/holidayScope.js";
import { scheduleOf } from "../utils/workHours.js";
import { todayInTz, zonedTimeToUtc } from "../utils/schedule.js";
import { stillHere, hasLeft } from "../utils/employeeStatus.js";
import {
  FIRST_DAYS_LENGTH, ROLE_PLAY_OPENS_AT, SESSION_ENDS_AT, CALL_LISTENING_OPENS_AT, MIN_CALL_NOTES,
  addDays, dayNumber, isChatGptShareLink, joiningDayKey, lastRedDay, workingDayKeys,
} from "../utils/firstDays.js";
import { applyBeat, watchProgress, type WatchState } from "../utils/watchSpans.js";
import { MAX_FILES, MIN_WRITE_UP, canAnswer, canWriteUp, fileList, hasQuestion, homeworkEntries, homeworkStatus, type HomeworkKind } from "../utils/homework.js";
import { vimeoEmbedUrl } from "../utils/vimeo.js";
import { videoLink } from "../utils/videoLink.js";
import { env } from "../config/env.js";

/**
 * A new joiner's first fifteen days: a red portal, and the steps of days 1 to
 * 3 laid out for them, their department head and HR.
 *
 * Day 1 — the induction video (done when watched) and the 10:30–1 pm session
 * (done when both the joiner and the head confirm it). Day 2 — the team's
 * video watched, in the teams HR picks an afternoon of listening in on
 * training calls written up by the joiner, and for sales teams a ChatGPT
 * role-play with the chat's link. Day 3 — 3CX and Zoho from HR, and for sales
 * teams the CRM from the head and the first cold calls on the team's default
 * clients.
 *
 * And homework, on any of the fifteen days: the head sets it with a question
 * document, and the joiner answers it from that day — see utils/homework.ts.
 * One for day 1 is expected; the rest are as many as the head sets.
 *
 * HR can do anything a head can, which covers the departments with no head.
 */

/**
 * What the joiner pastes into ChatGPT. Ours, not a team's: every sales joiner
 * practises against the same client, so their first calls can be compared.
 */
export const SALES_ROLE_PLAY_PROMPT = `You are role-playing a prospective customer of Delta Institutions, a training institute offering courses such as forex and trading mentorship, digital marketing and commerce. I am a new sales counsellor practising a sales call.

Stay in character as the customer until I type END, and never help me sell. At the start, secretly pick one persona: a busy working professional, a student worried about fees, a sceptic who thinks trading courses are scams, or a parent enquiring for their child. Give yourself a name and a situation.

Answer as if I'm calling about an enquiry you left online. Be realistic: short answers, some interest, and at least three objections (price, time, trust, needing to ask family). Ask what a real customer would: fees, instalments, schedule, online or in person, certificate, results, refunds. Don't agree to enrol unless I handle your concerns well.

When I type END, step out of character and give me feedback: what I did well, what I missed, how I handled each objection, and a score out of 10.`;

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export type StepKey = "induction" | "session" | "teamVideo" | "callListening" | "rolePlay" | "access" | "coldCalls";
export type StepStatus = "done" | "todo" | "waiting" | "overdue";

/** A file as it arrives, stored: a question document, an answer, or a homework video. */
type StoredFile = { key: string; name: string };
/** A video in the company's Vimeo folder, as checked with Vimeo when it was picked. */
export type VimeoRef = { id: string; hash: string; name: string };
/**
 * A new homework: a document's question, an uploaded video with its length
 * read from the file, or a video from Vimeo with its length from Vimeo.
 */
type NewHomework = {
  title: string; day: string; folder?: string;
  /** A document's question files, or an uploaded video (one). */
  files?: StoredFile[];
  vimeo?: VimeoRef; kind?: HomeworkKind; videoSeconds?: number;
};
/** What replaces a homework's question: a document, or a video — uploaded, or from Vimeo. */
type NewQuestion = { file?: StoredFile; video?: { seconds: number; vimeo?: VimeoRef } };
const vimeoLink = (v: { id: string; hash: string }) => `https://vimeo.com/${v.id}${v.hash ? `/${v.hash}` : ""}`;

/** An additional homework's video: uploaded, or a link to it elsewhere. */
type ExtraSource = { files?: StoredFile[]; link?: string };

/** A folder's name as stored: trimmed, single-spaced, short. "" means no folder. */
const folderName = (raw: string | null | undefined) => (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
/** The distinct folders in a list, in the order they first appear. */
const foldersOf = (items: { folder: string }[]) => Array.from(new Set(items.map((i) => i.folder).filter(Boolean)));
const stamp = (f: StoredFile, userId: string, at = new Date()) => ({ key: f.key, name: f.name, at, by: userId });
const isVideoKey = (key?: string | null) => /\.(mp4|mov|m4v|webm)$/i.test(key ?? "");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What the joiner is told to do with a homework, by kind. */
const HOMEWORK_TODO: Record<HomeworkKind, string> = {
  document: "Upload your answer today — what you did, as a file.",
  video: "Watch it to the end today, then write what you learned.",
};
const emptyWatch = () => ({ spans: [], lastPosition: 0, lastBeatAt: null, watchedSeconds: 0, skipAttempts: 0, completedAt: null });

/** Who is looking — what they may do follows from it. */
export interface Viewer { userId: string; isJoiner: boolean; isHead: boolean; isHr: boolean }

type Rec = InstanceType<typeof FirstDays>;
type EmployeeLite = {
  _id: unknown; name?: string; employeeCode?: string; designation?: string; user?: unknown;
  joiningDate?: Date | null; status?: string; workMode?: "office" | "wfh" | null;
  workSchedule?: { _id: unknown; timeZone?: string; workDays?: number[] } | null;
  department?: { _id: unknown; name?: string; isSales?: boolean; callListening?: boolean } | null;
};

const EMPLOYEE_FIELDS = "name employeeCode designation user joiningDate status workMode workSchedule department";
const loadEmployee = (filter: Record<string, unknown>) =>
  Employee.findOne(scoped(filter))
    .select(EMPLOYEE_FIELDS)
    .populate("workSchedule", "timeZone workDays name loginTime logoutTime halfDays mode requiredHours")
    .populate("department", "name isSales callListening")
    .lean<EmployeeLite | null>();

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
const fileOut = (f: { key?: string | null; name?: string | null; at?: Date | null } | null | undefined) =>
  f?.key ? { name: f.name || "File", url: publicUrl(f.key), at: f.at ?? null } : null;
/** A file in a list, with its key — what the page sends back to remove that one. */
const listedFile = (f: { key?: string | null; name?: string | null; at?: Date | null }) => ({ ...fileOut(f)!, key: f.key ?? "" });

/** The first day anyone gets this — nobody who joined before it ever does. */
const firstDaysFrom = () => env.FIRST_DAYS_FROM;

export class FirstDaysService {
  // ── Starting them ──────────────────────────────────────────────────────────

  /**
   * The joiner's record, created on their first day if they qualify, and its
   * days moved if HR has since changed their joining date. Null for anyone who
   * does not get one — joined before go-live, not yet started, no login, or
   * gone.
   */
  async ensureFor(emp: EmployeeLite | null): Promise<Rec | null> {
    if (!emp?.joiningDate || !emp.user || hasLeft(emp.status)) return null;
    const start = joiningDayKey(emp.joiningDate);
    if (start < firstDaysFrom()) return null;
    const schedule = scheduleOf(emp.workSchedule ?? null);
    const tz = schedule.timeZone;
    if (start > todayInTz(tz)) return null;

    const existing = await FirstDays.findOne(scoped({ employee: emp._id }));
    if (existing && existing.startDay === start) return existing;

    const holidays = await holidayKeysFor(
      emp.workMode ?? null,
      new Date(`${start}T00:00:00Z`),
      new Date(`${addDays(start, 45)}T00:00:00Z`),
      emp.workSchedule?._id ?? null
    );
    const days = { timeZone: tz, startDay: start, endDay: lastRedDay(start), stepDays: workingDayKeys(start, 3, schedule.workDays, holidays) };

    if (existing) {
      // HR corrected the joining date: the window and the step days follow it.
      Object.assign(existing, days);
      await existing.save();
      return existing;
    }

    let rec: Rec;
    try {
      rec = await FirstDays.create({ organization: getOrgId(), employee: emp._id, user: emp.user, ...days });
    } catch (err) {
      // Two requests on the same first morning: the other one made it.
      if ((err as { code?: number }).code === 11000) return FirstDays.findOne(scoped({ employee: emp._id }));
      throw err;
    }
    await this.announceStart(rec, emp);
    return rec;
  }

  /** Every joiner in this organisation whose first day has come, started. Cheap: a handful at most. */
  async syncOrg() {
    const from = new Date(`${addDays(firstDaysFrom(), -1)}T00:00:00Z`);
    const due = await Employee.find(scoped({
      joiningDate: { $gte: from, $lte: new Date(Date.now() + 86_400_000) },
      user: { $ne: null },
      status: stillHere(),
    }))
      .select(EMPLOYEE_FIELDS)
      .populate("workSchedule", "timeZone workDays name loginTime logoutTime halfDays mode requiredHours")
      .populate("department", "name isSales callListening")
      .lean<EmployeeLite[]>();
    let started = 0;
    for (const emp of due) {
      const had = await FirstDays.exists(scoped({ employee: emp._id }));
      if ((await this.ensureFor(emp)) && !had) started++;
    }
    await this.announceDueHomework();
    return { started };
  }

  /**
   * Homework set ahead for a day that has now come: the joiner is told that
   * morning. Each one is claimed before the message goes, so two runs at once
   * (the morning job and a head opening the page) never tell them twice.
   */
  private async announceDueHomework() {
    const pending = await FirstDays.find(scoped({ homeworks: { $elemMatch: { notifiedAt: null } } }))
      .select("user employee timeZone homeworks").lean();
    for (const rec of pending) {
      const today = todayInTz(rec.timeZone ?? "Asia/Dubai");
      const opening = (rec.homeworks ?? []).filter((h) => !h.notifiedAt && h.day <= today);
      if (!opening.length) continue;
      const emp = await Employee.findById(rec.employee).select("status").lean<{ status?: string } | null>();
      if (!emp || hasLeft(emp.status)) continue;
      const claimed: { title: string; kind: HomeworkKind }[] = [];
      for (const h of opening) {
        const r = await FirstDays.updateOne(
          { _id: rec._id, homeworks: { $elemMatch: { _id: h._id, notifiedAt: null } } },
          { $set: { "homeworks.$.notifiedAt": new Date() } }
        );
        if (r.modifiedCount) claimed.push({ title: h.title, kind: h.kind === "video" ? "video" : "document" });
      }
      if (!claimed.length) continue;
      await notify({
        users: [rec.user], kind: "reminder",
        title: claimed.length === 1 ? `New homework: ${claimed[0].title}` : `${claimed.length} new homework today`,
        body: claimed.length === 1 ? HOMEWORK_TODO[claimed[0].kind] : "They're in your first-days guide — do them today.",
        href: "/first-days",
      });
    }
  }

  /** The joiner, their head and HR, told on day 1. */
  private async announceStart(rec: Rec, emp: EmployeeLite) {
    const name = emp.name ?? "A new joiner";
    const day3 = rec.stepDays[2] ?? rec.startDay;
    const heads = (await headContactsFor(String(rec.user))).map((h) => h.userId);
    const hr = await watchersFor("onboardingTasks", undefined, "edit");
    // Usually the morning of day 1; later only if the morning run missed them,
    // and then "today" would be untrue.
    const today = rec.startDay === todayInTz(rec.timeZone);
    const when = today ? "today" : `on ${fmtDay(rec.startDay)}`;
    await notify({
      users: [rec.user],
      kind: "reminder",
      tone: "positive",
      title: today ? "Welcome! Your first 15 days start today" : "Welcome! Your first-days guide is ready",
      body: today
        ? "Your guide shows what to do each day — the induction video first, then today's session from 10:30 to 1 pm."
        : "Your guide shows what to do each day, and what is still left from your first days.",
      href: "/first-days",
    });
    await notify({
      users: heads,
      kind: "reminder",
      title: `${name} ${today ? "joins" : "joined"} your team ${when}`,
      body: "Their day-1 session runs 10:30 to 1 pm — confirm it afterwards, then add their day-1 homework.",
      href: "/first-days/team",
    });
    await notify({
      users: hr,
      kind: "reminder",
      title: `${name} ${today ? "starts" : "started"} ${when}`,
      body: `3CX and Zoho access are due by ${fmtDay(day3)}.${heads.length ? "" : " Their department has no head, so the head's steps are HR's."}`,
      href: "/first-days/team",
    });
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** The joiner's own guide, started if today is their day. Null for everybody else. */
  async mine(userId: string) {
    const emp = await loadEmployee({ user: userId });
    const rec = await this.ensureFor(emp);
    if (!rec || !emp) return null;
    return this.view(rec, emp, { userId, isJoiner: true, isHead: false, isHr: false });
  }

  /**
   * The joiners a head or HR looks after: still inside their fifteen days, or
   * with a step left. A head sees their own departments'; HR sees everyone.
   * Empty for anybody else, never refused — the dashboard asks everyone.
   */
  async team(userId: string, isHr: boolean) {
    const headed = await departmentsHeadedBy(userId);
    if (!isHr && !headed.length) return [];
    await this.syncOrg();

    const recent = await FirstDays.find(scoped({ startDay: { $gte: addDays(todayInTz("Asia/Dubai"), -60) } })).sort({ startDay: -1 });
    const out = [];
    for (const rec of recent) {
      if (String(rec.user) === String(userId)) continue;
      const emp = await loadEmployee({ _id: rec.employee });
      if (!emp || hasLeft(emp.status)) continue;
      const deptId = emp.department ? String(emp.department._id) : "";
      const isHead = headed.includes(deptId);
      if (!isHead && !isHr) continue;
      const v = await this.view(rec, emp, { userId, isJoiner: false, isHead, isHr });
      if (v.redActive || !v.complete) out.push(v);
    }
    return out;
  }

  /**
   * The steps as this viewer sees them, with what each of them may do now.
   *
   * A step is "waiting" when it cannot be done yet — its time has not come,
   * or something before it has not happened — and "overdue" once its day has
   * passed undone. Nothing is blocked by an overdue step except what truly
   * depends on it: a result cannot come back before the homework went out.
   */
  async view(rec: Rec, emp: EmployeeLite, viewer: Viewer) {
    const tz = rec.timeZone;
    const now = new Date();
    const today = todayInTz(tz, now);
    const [d1, d2, d3] = [rec.stepDays[0] ?? rec.startDay, rec.stepDays[1] ?? rec.startDay, rec.stepDays[2] ?? rec.startDay];
    const sales = !!emp.department?.isSales;
    const asHead = viewer.isHead || viewer.isHr;

    const status = (done: boolean, due: string, waiting: boolean): StepStatus =>
      done ? "done" : waiting ? "waiting" : today > due ? "overdue" : "todo";

    // The induction video is the organisation's; with none set up there is nothing to watch.
    const [inductionVideo, inductionDone] = await Promise.all([
      InductionVideo.exists(scoped({ active: true })),
      VideoView.exists(scoped({ user: rec.user, completedAt: { $ne: null } })),
    ]);
    const teamVideo = emp.department ? await TeamVideo.findOne(scoped({ department: emp.department._id, active: true })).lean() : null;
    const tv = rec.teamVideo;
    const teamVideoDone = !!teamVideo && !!tv?.completedAt && String(tv.video) === String(teamVideo._id);

    const sessionOpens = zonedTimeToUtc(d1, SESSION_ENDS_AT, tz);
    const rolePlayOpens = zonedTimeToUtc(d2, ROLE_PLAY_OPENS_AT, tz);
    const callsOpen = zonedTimeToUtc(d2, CALL_LISTENING_OPENS_AT, tz);
    const d2Opens = zonedTimeToUtc(d2, "00:00", tz);
    const access = rec.access;

    const steps = [
      {
        key: "induction" as StepKey, day: 1, dueDay: d1,
        title: "Watch the induction video",
        detail: inductionVideo ? "Marked done on its own once you've watched it to the end." : "No induction video is set up, so there is nothing to watch.",
        status: status(!!inductionDone || !inductionVideo, d1, false),
        can: [] as string[],
      },
      {
        key: "session" as StepKey, day: 1, dueDay: d1,
        title: "Session, 10:30 to 1 pm",
        detail: "With your department head. Both of you confirm it once it's over.",
        status: status(!!rec.session?.joinerAt && !!rec.session?.headAt, d1, now < sessionOpens),
        opensAt: sessionOpens,
        joinerConfirmed: !!rec.session?.joinerAt,
        headConfirmed: !!rec.session?.headAt,
        can: now < sessionOpens ? [] : [
          ...(viewer.isJoiner && !rec.session?.joinerAt ? ["confirm"] : []),
          ...(asHead && !rec.session?.headAt ? ["confirmHead"] : []),
        ],
      },
      {
        key: "teamVideo" as StepKey, day: 2, dueDay: d2,
        title: "Watch your team's video",
        detail: "From your department head. Marked done on its own once you've watched it to the end.",
        status: status(teamVideoDone, d2, now < d2Opens || !teamVideo),
        opensAt: d2Opens,
        waitingFor: teamVideo ? null : "your department head to add the team video",
        video: teamVideo ? { title: teamVideo.title, durationSeconds: teamVideo.durationSeconds } : null,
        percent: teamVideo && tv && String(tv.video) === String(teamVideo._id) ? watchProgress(tv as unknown as WatchState, teamVideo.durationSeconds).percent : 0,
        can: viewer.isJoiner && teamVideo && now >= d2Opens && !teamVideoDone ? ["watch"] : [],
      },
      ...(emp.department?.callListening ? [{
        key: "callListening" as StepKey, day: 2, dueDay: d2,
        title: "Listen in on training calls",
        detail: "This afternoon you sit in on real calls. Afterwards, write down what you heard and what you learned from it.",
        status: status(!!rec.callListening?.at, d2, now < callsOpen),
        opensAt: callsOpen,
        notes: rec.callListening?.notes || null,
        can: viewer.isJoiner && now >= callsOpen ? [rec.callListening?.at ? "replace" : "submit"] : [],
      }] : []),
      ...(sales ? [{
        key: "rolePlay" as StepKey, day: 2, dueDay: d2,
        title: "Sales role-play with ChatGPT",
        detail: "Copy the prompt into ChatGPT, sell to the client it plays, then share the chat and paste its link here.",
        status: status(!!rec.rolePlay?.link, d2, now < rolePlayOpens),
        opensAt: rolePlayOpens,
        prompt: viewer.isJoiner || asHead ? SALES_ROLE_PLAY_PROMPT : null,
        link: rec.rolePlay?.link || null,
        can: viewer.isJoiner && now >= rolePlayOpens ? [rec.rolePlay?.link ? "replace" : "submit"] : [],
      }] : []),
      {
        key: "access" as StepKey, day: 3, dueDay: d3,
        title: sales ? "3CX, Zoho and CRM access" : "3CX and Zoho access",
        detail: sales ? "HR gives 3CX and Zoho; your department head gives the sales CRM." : "Given by HR.",
        status: status(!!access?.threeCx?.at && !!access?.zoho?.at && (!sales || !!access?.crm?.at), d3, false),
        tools: {
          threeCx: !!access?.threeCx?.at,
          zoho: !!access?.zoho?.at,
          crm: sales ? !!access?.crm?.at : null,
        },
        can: [
          ...(viewer.isHr ? ["threeCx", "zoho"] : []),
          ...(sales && asHead ? ["crm"] : []),
        ],
      },
      ...(sales ? [{
        key: "coldCalls" as StepKey, day: 3, dueDay: d3,
        title: "First cold calls",
        detail: "Your department gives you default clients in the CRM. Call them, then mark it done.",
        status: status(!!rec.coldCalls?.doneAt, d3, !rec.coldCalls?.assignedAt),
        waitingFor: rec.coldCalls?.assignedAt ? null : "your department head to assign your default clients",
        assigned: !!rec.coldCalls?.assignedAt,
        can: [
          ...(asHead && !rec.coldCalls?.assignedAt ? ["assign"] : []),
          ...(viewer.isJoiner && rec.coldCalls?.assignedAt && !rec.coldCalls?.doneAt ? ["done"] : []),
        ],
      }] : []),
    ].map((s) => ({ waitingFor: null as string | null, opensAt: null as Date | null, ...s }));

    const homework = this.homeworkView(rec, viewer, today);
    const extras = this.extrasView(rec, viewer, today);
    const doneCount = steps.filter((s) => s.status === "done").length + homework.answered;
    const totalCount = steps.length + homework.total;
    return {
      employee: {
        _id: emp._id, name: emp.name ?? "—", employeeCode: emp.employeeCode ?? "", designation: emp.designation ?? "",
        department: emp.department ? { _id: emp.department._id, name: emp.department.name ?? "", isSales: sales } : null,
      },
      startDay: rec.startDay,
      endDay: rec.endDay,
      day: dayNumber(rec.startDay, today),
      of: FIRST_DAYS_LENGTH,
      redActive: today >= rec.startDay && today <= rec.endDay,
      today,
      stepDays: [d1, d2, d3],
      steps,
      homework,
      extras,
      doneCount,
      totalCount,
      complete: doneCount === totalCount,
      viewer: { isJoiner: viewer.isJoiner, isHead: viewer.isHead, isHr: viewer.isHr },
    };
  }

  /**
   * The homework list as this viewer sees it. Each homework counts as one step.
   *
   * Day 1's is expected: until the head sets one for that day, a stand-in
   * says so — overdue for the head once day 1 has passed, and for the joiner
   * simply waiting, since it is not theirs to do. A homework for a day still
   * ahead shows the joiner that it is coming, not what it asks.
   */
  private homeworkView(rec: Rec, viewer: Viewer, today: string) {
    const tz = rec.timeZone;
    const d1 = rec.stepDays[0] ?? rec.startDay;
    const asHead = viewer.isHead || viewer.isHr;
    // Set during the fifteen days, for one of them.
    const mayAdd = asHead && today >= rec.startDay && today <= rec.endDay;
    const entries = homeworkEntries(rec, tz);

    const items = entries.map((e) => {
      const { status, late } = homeworkStatus(e, today, tz);
      const ahead = today < e.day;
      const video = e.kind === "video";
      const watch = video ? rec.homeworks.id(e.id)?.watch : null;
      const hidden = viewer.isJoiner && ahead;
      return {
        id: e.id, placeholder: false, kind: e.kind, title: e.title, day: e.day, dayNumber: dayNumber(rec.startDay, e.day), dueDay: e.dueDay,
        status: status as StepStatus, late, folder: e.folder,
        question: hidden ? null : fileOut(e.question),
        questions: hidden ? [] : e.questions.filter((f) => f.key).map(listedFile),
        answers: e.answers.filter((f) => f.key).map(listedFile),
        // The joiner watches it in HRMS, never on vimeo.com, where nothing counts.
        vimeo: e.vimeo && !viewer.isJoiner ? { name: e.vimeo.name, link: vimeoLink(e.vimeo) } : e.vimeo ? { name: e.vimeo.name, link: "" } : null,
        answer: fileOut(e.answer),
        notes: e.notes,
        durationSeconds: e.videoSeconds,
        watched: e.watched,
        percent: video && watch && e.videoSeconds ? watchProgress(watch as unknown as WatchState, e.videoSeconds).percent : 0,
        opensAt: ahead ? zonedTimeToUtc(e.day, "00:00", tz) : null,
        // Kept from before questions were required: the answer stands, and the head can put the question with it.
        missingQuestion: !hasQuestion(e),
        // The old fixed slots keep one file each side, replaced rather than added to.
        can: [
          ...(viewer.isJoiner && canAnswer(e, today)
            ? video
              ? ["watch", ...(canWriteUp(e, today) ? ["writeUp"] : [])]
              : e.legacy ? [e.answer ? "replaceAnswer" : "answer"] : [e.answers.length ? "addAnswer" : "answer"]
            : []),
          ...(asHead
            ? e.legacy ? [hasQuestion(e) ? "replaceQuestion" : "attachQuestion"]
              : video ? ["replaceQuestion", "move"] : ["addFiles", "move"]
            : []),
        ],
      };
    });
    if (!entries.some((e) => e.day === d1)) {
      items.unshift({
        id: "day-1", placeholder: true, kind: "document", title: "Day-1 homework", day: d1, dayNumber: 1, dueDay: d1,
        status: (viewer.isJoiner ? "waiting" : today > d1 ? "overdue" : "todo") as StepStatus, late: false, folder: "",
        question: null, questions: [], answers: [], vimeo: null, answer: null, notes: null, durationSeconds: 0, watched: false, percent: 0, opensAt: null, missingQuestion: false,
        can: mayAdd ? ["add"] : [],
      });
    }

    const days: { key: string; number: number }[] = [];
    if (mayAdd) for (let k = rec.startDay; k <= rec.endDay; k = addDays(k, 1)) days.push({ key: k, number: dayNumber(rec.startDay, k) });
    return {
      items,
      answered: items.filter((i) => i.status === "done").length,
      total: items.length,
      canAdd: mayAdd,
      /** The days a homework can be set for — empty for anyone who can't set one now. */
      days,
      /** The folders in use on this guide, for picking one again. */
      folders: foldersOf(entries),
    };
  }

  /**
   * The joiner's additional homework — their own presentation videos, with any
   * feedback. Not counted in their progress: it is optional, and never overdue.
   */
  private extrasView(rec: Rec, viewer: Viewer, today: string) {
    const asHead = viewer.isHead || viewer.isHr;
    const items = [...(rec.extras ?? [])]
      .sort((a, b) => (a.addedAt?.getTime() ?? 0) - (b.addedAt?.getTime() ?? 0))
      .map((x) => {
        const { files, links } = FirstDaysService.extraContents(x);
        return {
          id: String(x._id), title: x.title, day: x.day, dayNumber: dayNumber(rec.startDay, x.day), folder: x.folder ?? "",
          files: files.filter((f) => f.key).map((f) => ({ ...listedFile(f), isVideo: isVideoKey(f.key) })),
          links: links.map((url) => ({ url, host: videoLink(url)?.host ?? "Link" })),
          addedAt: x.addedAt ?? null, updatedAt: x.updatedAt ?? null,
          feedback: (x.feedback ?? []).map((f) => ({ text: f.text, byName: f.byName || "Department head", at: f.at ?? null })),
          can: [...(viewer.isJoiner ? ["addFiles", "remove", "move"] : []), ...(asHead ? ["feedback"] : [])],
        };
      });
    // Added during the fifteen days; added to, any time.
    return { items, canAdd: viewer.isJoiner && today >= rec.startDay && today <= rec.endDay, folders: foldersOf(items) };
  }

  // ── The joiner's own steps ─────────────────────────────────────────────────

  private async mineOrFail(userId: string) {
    const emp = await loadEmployee({ user: userId });
    const rec = await this.ensureFor(emp);
    if (!rec || !emp) throw fail("You have no first-days guide", 404);
    return { rec, emp };
  }

  private async mineView(userId: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    return this.view(rec, emp, { userId, isJoiner: true, isHead: false, isHr: false });
  }

  async confirmSessionMine(userId: string) {
    const { rec } = await this.mineOrFail(userId);
    if (new Date() < zonedTimeToUtc(rec.stepDays[0] ?? rec.startDay, SESSION_ENDS_AT, rec.timeZone)) {
      throw fail("The session can be confirmed once it's over, from 1 pm");
    }
    if (!rec.session?.joinerAt) {
      rec.set("session.joinerAt", new Date());
      await rec.save();
      if (!rec.session?.headAt) {
        const name = (await User.findById(userId).select("name").lean<{ name?: string } | null>())?.name ?? "Your new joiner";
        await notify({
          users: (await headContactsFor(userId)).map((h) => h.userId),
          kind: "reminder",
          title: `${name} confirmed their day-1 session`,
          body: "Confirm it on your side too, then add their day-1 homework.",
          href: "/first-days/team",
          actor: userId,
        });
      }
    }
    return this.mineView(userId);
  }

  /** One of the joiner's own homework, open to them today — refused otherwise, saying why. */
  private async myOpenHomework(userId: string, itemId: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    const today = todayInTz(rec.timeZone);
    const entry = homeworkEntries(rec, rec.timeZone).find((e) => e.id === itemId);
    if (!entry) throw fail("That homework isn't in your guide", 404);
    if (!hasQuestion(entry)) throw fail("Your department head hasn't added the question for this homework yet");
    if (!canAnswer(entry, today)) throw fail(`This homework opens on ${fmtDay(entry.day)}`);
    return { rec, emp, entry, today };
  }

  /**
   * The joiner's answer to a document homework: one or more files, added to
   * what they already handed in. Only once its question is on file and its
   * day has come; late is accepted, and marked by when the first file came.
   * The two old fixed slots take one file, which replaces the last.
   */
  async answerHomework(userId: string, itemId: string, files: StoredFile[]) {
    const { rec, emp, entry, today } = await this.myOpenHomework(userId, itemId);
    if (entry.kind === "video") throw fail("This homework is a video — watch it, then write what you learned");
    if (!files.length) throw fail("Attach your answer");
    const again = entry.answers.length > 0;
    const now = new Date();
    if (entry.legacy) {
      if (files.length > 1) throw fail("This homework takes one file");
      rec.set(entry.legacy === 1 ? "homeworkResult" : "homework2Result", stamp(files[0], userId, now));
    } else {
      const all = [...entry.answers, ...files.map((f) => stamp(f, userId, now))];
      if (all.length > MAX_FILES) throw fail(`An answer can have up to ${MAX_FILES} files — remove one first`);
      const h = rec.homeworks.id(itemId)!;
      h.set("answerFiles", all);
      h.set("answer", all[0]);
      if (!h.answeredAt) h.set("answeredAt", now);
    }
    await rec.save();
    const names = files.map((f) => f.name).join(", ");
    await notify({
      users: (await headContactsFor(userId)).map((h) => h.userId),
      kind: "reminder",
      title: again
        ? `${emp.name ?? "Your new joiner"} added ${plural(files.length, "file")} to their answer for “${entry.title}”`
        : `${emp.name ?? "Your new joiner"} answered “${entry.title}”`,
      body: today > entry.dueDay && !again ? `${names} · late — it was due ${fmtDay(entry.dueDay)}` : names,
      href: "/first-days/team",
      actor: userId,
    });
    return this.mineView(userId);
  }

  /**
   * Take one of their answer files back. A document's answer keeps at least
   * one file — add the right one, then remove the wrong one; a video
   * write-up's attachments are optional, so they can all go.
   */
  async removeAnswerFile(userId: string, itemId: string, key: string) {
    const { rec, entry } = await this.myOpenHomework(userId, itemId);
    if (entry.legacy) throw fail("Upload the new file instead — it replaces this one");
    const left = entry.answers.filter((f) => f.key !== key);
    if (left.length === entry.answers.length) throw fail("That file isn't in your answer", 404);
    if (entry.kind === "document" && !left.length) throw fail("Keep at least one file — add the new one first, then remove this one");
    const h = rec.homeworks.id(itemId)!;
    h.set("answerFiles", left);
    h.set("answer", left[0] ?? null);
    await rec.save();
    return this.mineView(userId);
  }

  /** A video homework of the joiner's, open today — refused otherwise, saying why. */
  private async myVideoHomework(userId: string, itemId: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    const today = todayInTz(rec.timeZone);
    const entry = homeworkEntries(rec, rec.timeZone).find((e) => e.id === itemId);
    if (!entry) throw fail("That homework isn't in your guide", 404);
    if (entry.kind !== "video") throw fail("This homework isn't a video");
    if (!canAnswer(entry, today)) throw fail(`This homework opens on ${fmtDay(entry.day)}`);
    const h = rec.homeworks.id(itemId)!;
    if (!h.watch) h.set("watch", emptyWatch());
    return { rec, emp, entry, h, today };
  }

  private static watchState(w: { spans?: { from: number; to: number }[]; lastPosition?: number; lastBeatAt?: Date | null; watchedSeconds?: number; skipAttempts?: number; completedAt?: Date | null } | null | undefined): WatchState {
    return {
      spans: (w?.spans ?? []).map((s) => ({ from: s.from, to: s.to })),
      lastPosition: w?.lastPosition ?? 0,
      lastBeatAt: w?.lastBeatAt ?? null,
      watchedSeconds: w?.watchedSeconds ?? 0,
      skipAttempts: w?.skipAttempts ?? 0,
      completedAt: w?.completedAt ?? null,
    };
  }

  /**
   * Open a video homework where they left off. Watched the induction's way:
   * the server counts what played from where the playhead is every few
   * seconds, so skipping ahead counts for nothing; going back is fine.
   */
  async startHomeworkVideo(userId: string, itemId: string) {
    const { rec, entry, h } = await this.myVideoHomework(userId, itemId);
    const progress = watchProgress(FirstDaysService.watchState(h.watch), entry.videoSeconds);
    if (!progress.completed) {
      h.set("watch.lastBeatAt", new Date());
      h.set("watch.lastPosition", progress.resumeAt);
    }
    await rec.save();
    return {
      video: {
        title: entry.title,
        url: entry.question?.key ? publicUrl(entry.question.key) : "",
        durationSeconds: entry.videoSeconds,
        // A Vimeo video plays in Vimeo's player; the counting is the same.
        vimeo: entry.vimeo ? { embedUrl: vimeoEmbedUrl(entry.vimeo.id, entry.vimeo.hash) } : null,
      },
      progress,
    };
  }

  async homeworkVideoBeat(userId: string, itemId: string, position: number) {
    const { rec, entry, h } = await this.myVideoHomework(userId, itemId);
    const next = applyBeat(FirstDaysService.watchState(h.watch), position, entry.videoSeconds, new Date());
    h.set("watch", next);
    await rec.save();
    return watchProgress(next, entry.videoSeconds);
  }

  /**
   * The joiner's write-up of a video homework — what they learned — with a
   * file if they want one. Opens once the video has been watched to the end;
   * handing it in is what completes the homework. It can be changed after;
   * files sent with it are added to any already there.
   */
  async submitWriteUp(userId: string, itemId: string, notes: string, files: StoredFile[]) {
    const { rec, emp, entry, h, today } = await this.myVideoHomework(userId, itemId);
    if (!canWriteUp(entry, today)) throw fail("Watch the video to the end first — then write what you learned");
    const text = notes.trim();
    if (text.length < MIN_WRITE_UP) throw fail("Write a little more about what you learned — a sentence or two at least");
    const again = entry.handedIn;
    const now = new Date();
    h.set("notes", text.slice(0, 4000));
    if (files.length) {
      const all = [...entry.answers, ...files.map((f) => stamp(f, userId, now))];
      if (all.length > MAX_FILES) throw fail(`A write-up can have up to ${MAX_FILES} files — remove one first`);
      h.set("answerFiles", all);
      h.set("answer", all[0]);
    }
    if (!h.answeredAt) h.set("answeredAt", now);
    await rec.save();
    await notify({
      users: (await headContactsFor(userId)).map((x) => x.userId),
      kind: "reminder",
      title: `${emp.name ?? "Your new joiner"} ${again ? "changed their write-up for" : "watched and wrote up"} “${entry.title}”`,
      body: today > entry.dueDay && !again ? `Late — it was due ${fmtDay(entry.dueDay)}. ${text.slice(0, 120)}` : text.slice(0, 160),
      href: "/first-days/team",
      actor: userId,
    });
    return this.mineView(userId);
  }

  // ── Additional homework — the joiner's own presentation videos ─────────────

  /** An additional homework's files and links, as lists — one video or link from before reads as a list of one. */
  private static extraContents(x: { files?: unknown; video?: unknown; links?: unknown; link?: string | null }) {
    const files = fileList(x.files as StoredFile[] | null, x.video as StoredFile | null) as (StoredFile & { at?: Date | null })[];
    const stored = ((x.links as string[] | null | undefined) ?? []).filter(Boolean);
    const links = stored.length ? stored : x.link ? [x.link] : [];
    return { files, links };
  }

  /** What the joiner is adding: their files, stamped, and a link we accept. */
  private extraAdditions(input: ExtraSource, userId: string) {
    const files = (input.files ?? []).map((f) => stamp(f, userId));
    let link: string | null = null;
    if (input.link !== undefined) {
      const ok = videoLink(input.link);
      if (!ok) throw fail("Paste a Google Drive, YouTube or Vimeo link to the video");
      link = ok.url;
    }
    if (!files.length && !link) throw fail("Choose a file, or paste a link");
    return { files, link };
  }

  /** Their head and HR, told something came in. */
  private async announceExtra(userId: string, name: string, title: string, added: number | null) {
    const heads = (await headContactsFor(userId)).map((h) => String(h.userId));
    const hr = (await watchersFor("onboardingTasks", undefined, "edit")).map(String);
    const users = Array.from(new Set([...heads, ...hr])).filter((u) => u !== String(userId));
    if (!users.length) return;
    await notify({
      users, kind: "reminder",
      title: added === null ? `${name} handed in additional homework` : `${name} added ${plural(added, "file")} to their additional homework`,
      body: title,
      href: "/first-days/team",
      actor: userId,
    });
  }

  /**
   * A new additional homework, on any day of the fifteen: a title, a folder if
   * they like, and its first file or link. The rest of a batch is added after,
   * one file at a time, so a handful of large videos never sit in memory at once.
   */
  async addExtra(userId: string, title: string, folder: string, input: ExtraSource) {
    const { rec, emp } = await this.mineOrFail(userId);
    const today = todayInTz(rec.timeZone);
    if (today > rec.endDay) throw fail(`Additional homework is added during your first fifteen days — they ended on ${fmtDay(rec.endDay)}`);
    const { files, link } = this.extraAdditions(input, userId);
    const name = title.trim().slice(0, 160) || "Presentation";
    const now = new Date();
    rec.extras.push({ title: name, day: today, folder: folderName(folder), files, links: link ? [link] : [], addedAt: now, updatedAt: now });
    await rec.save();
    await this.announceExtra(userId, emp.name ?? "Your new joiner", name, null);
    const added = rec.extras[rec.extras.length - 1];
    return { view: await this.mineView(userId), extraId: String(added._id) };
  }

  /**
   * More files or a link for one already handed in — any time. `quiet` is for
   * the rest of a batch the joiner sent together: they're told about once.
   */
  async addToExtra(userId: string, extraId: string, input: ExtraSource, quiet = false) {
    const { rec, emp } = await this.mineOrFail(userId);
    const x = (rec.extras ?? []).find((e) => String(e._id) === extraId);
    if (!x) throw fail("That additional homework isn't in your guide", 404);
    const { files, link } = this.extraAdditions(input, userId);
    const now = FirstDaysService.extraContents(x);
    const nextFiles = [...now.files, ...files];
    const nextLinks = link ? [...now.links, link] : now.links;
    if (nextFiles.length + nextLinks.length > MAX_FILES) throw fail(`An additional homework can have up to ${MAX_FILES} files and links — remove one first`);
    x.set("files", nextFiles);
    x.set("links", nextLinks);
    x.set("video", null);
    x.set("link", "");
    x.set("updatedAt", new Date());
    await rec.save();
    if (!quiet) await this.announceExtra(userId, emp.name ?? "Your new joiner", x.title, files.length + (link ? 1 : 0));
    return this.mineView(userId);
  }

  /** Take a file or link back out. One always stays — add the right one, then remove the wrong one. */
  async removeFromExtra(userId: string, extraId: string, what: { key?: string; link?: string }) {
    const { rec } = await this.mineOrFail(userId);
    const x = (rec.extras ?? []).find((e) => String(e._id) === extraId);
    if (!x) throw fail("That additional homework isn't in your guide", 404);
    const now = FirstDaysService.extraContents(x);
    const files = what.key ? now.files.filter((f) => f.key !== what.key) : now.files;
    const links = what.link ? now.links.filter((l) => l !== what.link) : now.links;
    if (files.length === now.files.length && links.length === now.links.length) throw fail("That isn't in this additional homework", 404);
    if (!files.length && !links.length) throw fail("Keep at least one file or link — add the new one first, then remove this one");
    x.set("files", files);
    x.set("links", links);
    x.set("video", null);
    x.set("link", "");
    x.set("updatedAt", new Date());
    await rec.save();
    return this.mineView(userId);
  }

  /** Put one of their additional homework in a folder — "" takes it out of any. */
  async moveExtra(userId: string, extraId: string, folder: string) {
    const { rec } = await this.mineOrFail(userId);
    const x = (rec.extras ?? []).find((e) => String(e._id) === extraId);
    if (!x) throw fail("That additional homework isn't in your guide", 404);
    x.set("folder", folderName(folder));
    await rec.save();
    return this.mineView(userId);
  }

  /** The head's (or HR's) feedback on a joiner's additional homework; the joiner is told. */
  async extraFeedback(employeeId: string, extraId: string, userId: string, isHr: boolean, text: string) {
    const { rec, emp, viewer } = await this.forReviewer(employeeId, userId, isHr);
    const x = (rec.extras ?? []).find((e) => String(e._id) === extraId);
    if (!x) throw fail("That additional homework isn't in their guide", 404);
    const note = text.trim().slice(0, 2000);
    if (note.length < 2) throw fail("Write your feedback first");
    const byName = (await User.findById(userId).select("name").lean<{ name?: string } | null>())?.name ?? "";
    x.feedback.push({ text: note, by: userId, byName, at: new Date() });
    await rec.save();
    await notify({
      users: [rec.user], kind: "reminder",
      title: `Feedback on “${x.title}”`,
      body: `${byName || "Your department head"}: ${note.slice(0, 140)}`,
      href: "/first-days", actor: userId,
    });
    return this.view(rec, emp, viewer);
  }

  async submitRolePlay(userId: string, link: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    if (!emp.department?.isSales) throw fail("The role-play is for sales teams");
    if (new Date() < zonedTimeToUtc(rec.stepDays[1] ?? rec.startDay, ROLE_PLAY_OPENS_AT, rec.timeZone)) {
      throw fail("The role-play opens on your second day, from 1 pm");
    }
    if (!isChatGptShareLink(link)) {
      throw fail("Paste the link from ChatGPT's Share button — it starts with https://chatgpt.com/share/");
    }
    rec.set("rolePlay", { link: link.trim(), at: new Date() });
    await rec.save();
    return this.mineView(userId);
  }

  /** The joiner's write-up of the training calls; submitting it completes the step. */
  async submitCallNotes(userId: string, notes: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    if (!emp.department?.callListening) throw fail("Listening in on training calls isn't a step for your team");
    if (new Date() < zonedTimeToUtc(rec.stepDays[1] ?? rec.startDay, CALL_LISTENING_OPENS_AT, rec.timeZone)) {
      throw fail("The training calls are on the afternoon of your second day, from 1 pm");
    }
    const text = notes.trim();
    if (text.length < MIN_CALL_NOTES) throw fail("Write a little more about what you heard — a sentence or two at least");
    const first = !rec.callListening?.at;
    rec.set("callListening", { notes: text.slice(0, 4000), at: new Date() });
    await rec.save();
    if (first) {
      await notify({
        users: (await headContactsFor(userId)).map((h) => h.userId),
        kind: "reminder",
        title: `${emp.name ?? "Your new joiner"} wrote up their training calls`,
        body: text.slice(0, 160),
        href: "/first-days/team",
        actor: userId,
      });
    }
    return this.mineView(userId);
  }

  async callsDone(userId: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    if (!emp.department?.isSales) throw fail("Cold calls are for sales teams");
    if (!rec.coldCalls?.assignedAt) throw fail("Your default clients haven't been assigned yet");
    if (!rec.coldCalls.doneAt) {
      rec.set("coldCalls.doneAt", new Date());
      await rec.save();
    }
    return this.mineView(userId);
  }

  // ── The team video, as the joiner watches it ───────────────────────────────

  private async teamVideoOf(userId: string) {
    const { rec, emp } = await this.mineOrFail(userId);
    const video = emp.department ? await TeamVideo.findOne(scoped({ department: emp.department._id, active: true })).lean() : null;
    if (!video) throw fail("Your department head hasn't added the team video yet", 409);
    if (new Date() < zonedTimeToUtc(rec.stepDays[1] ?? rec.startDay, "00:00", rec.timeZone)) {
      throw fail("The team video opens on your second day");
    }
    // A new video replaces the old one's progress: it is a different film.
    if (String(rec.teamVideo?.video ?? "") !== String(video._id)) {
      rec.set("teamVideo", { video: video._id, spans: [], lastPosition: 0, lastBeatAt: null, watchedSeconds: 0, skipAttempts: 0, completedAt: null });
    }
    return { rec, video };
  }

  private state(rec: Rec): WatchState {
    const tv = rec.teamVideo!;
    return {
      spans: (tv.spans ?? []).map((s) => ({ from: s.from, to: s.to })),
      lastPosition: tv.lastPosition ?? 0,
      lastBeatAt: tv.lastBeatAt ?? null,
      watchedSeconds: tv.watchedSeconds ?? 0,
      skipAttempts: tv.skipAttempts ?? 0,
      completedAt: tv.completedAt ?? null,
    };
  }

  /** Open the team video where they left off. The clock re-anchors, as the induction's does. */
  async startTeamVideo(userId: string) {
    const { rec, video } = await this.teamVideoOf(userId);
    const progress = watchProgress(this.state(rec), video.durationSeconds);
    if (!progress.completed) {
      rec.set("teamVideo.lastBeatAt", new Date());
      rec.set("teamVideo.lastPosition", progress.resumeAt);
    }
    await rec.save();
    return {
      video: { title: video.title, url: publicUrl(video.fileKey), durationSeconds: video.durationSeconds },
      progress,
    };
  }

  async teamVideoBeat(userId: string, position: number) {
    const { rec, video } = await this.teamVideoOf(userId);
    const next = applyBeat(this.state(rec), position, video.durationSeconds, new Date());
    rec.set("teamVideo", { video: video._id, ...next });
    await rec.save();
    return watchProgress(next, video.durationSeconds);
  }

  // ── The head's and HR's steps ──────────────────────────────────────────────

  /** The joiner's record, refused to anybody but their department head and HR. */
  private async forReviewer(employeeId: string, userId: string, isHr: boolean) {
    const rec = await FirstDays.findOne(scoped({ employee: employeeId }));
    if (!rec) throw fail("No first-days guide for this employee", 404);
    const isHead = await headsDepartmentOf(userId, String(rec.user));
    if (!isHead && !isHr) throw fail("Only their department head or HR can do this", 403);
    const emp = await loadEmployee({ _id: employeeId });
    if (!emp) throw fail("Employee not found", 404);
    return { rec, emp, viewer: { userId, isJoiner: false, isHead, isHr } as Viewer };
  }

  async confirmSessionHead(employeeId: string, userId: string, isHr: boolean) {
    const { rec, emp, viewer } = await this.forReviewer(employeeId, userId, isHr);
    if (new Date() < zonedTimeToUtc(rec.stepDays[0] ?? rec.startDay, SESSION_ENDS_AT, rec.timeZone)) {
      throw fail("The session can be confirmed once it's over, from 1 pm");
    }
    if (!rec.session?.headAt) {
      rec.set("session.headAt", new Date());
      rec.set("session.headBy", userId);
      await rec.save();
      if (!rec.session?.joinerAt) {
        await notify({
          users: [rec.user], kind: "reminder",
          title: "Confirm your day-1 session",
          body: "Your department head has confirmed it — confirm it on your side too.",
          href: "/first-days", actor: userId,
        });
      }
    }
    return this.view(rec, emp, viewer);
  }

  /**
   * Set a homework for one of the joiner's fifteen days, with its question
   * document. Only while those days last. For today, or a day already gone,
   * the joiner is told now and can answer at once — due today, never late for
   * the head's lateness; for a day ahead, they are told that morning.
   */
  async addHomework(employeeId: string, userId: string, isHr: boolean, input: NewHomework) {
    const { rec, emp, viewer } = await this.mayAddHomework(employeeId, userId, isHr, input.day);
    const kind: HomeworkKind = input.kind === "video" ? "video" : "document";
    const files = input.files ?? [];
    if (!files.length && !(kind === "video" && input.vimeo)) throw fail(kind === "video" ? "Choose the video" : "Attach the question document");
    if (kind === "video" && files.length > 1) throw fail("A video homework holds one video — put the others in their own homework, in the same folder");
    if (files.length > MAX_FILES) throw fail(`A homework can have up to ${MAX_FILES} question files`);
    const title = input.title.trim().slice(0, 160) || "Homework";
    const now = new Date();
    const opensNow = input.day <= todayInTz(rec.timeZone);
    const stamped = files.map((f) => stamp(f, userId, now));
    rec.homeworks.push({
      title, kind, day: input.day, folder: folderName(input.folder),
      question: stamped[0] ?? null,
      questionFiles: kind === "document" ? stamped : [],
      vimeo: kind === "video" && !files.length && input.vimeo ? input.vimeo : null,
      videoSeconds: kind === "video" ? Math.round(input.videoSeconds ?? 0) : 0,
      watch: kind === "video" ? emptyWatch() : null,
      addedAt: now, addedBy: userId, notifiedAt: opensNow ? now : null,
    });
    await rec.save();
    if (opensNow) {
      await notify({
        users: [rec.user], kind: "reminder",
        title: `New homework: ${title}`,
        body: HOMEWORK_TODO[kind],
        href: "/first-days", actor: userId,
      });
    }
    return this.view(rec, emp, viewer);
  }

  /**
   * Whether this head (or HR) may set this joiner a homework for that day —
   * their own department's joiner, during the fifteen days, for one of them.
   * Asked before a large video is stored, as well as when it is saved.
   */
  async mayAddHomework(employeeId: string, userId: string, isHr: boolean, day: string) {
    const found = await this.forReviewer(employeeId, userId, isHr);
    const { rec, emp } = found;
    const name = emp.name ?? "This joiner";
    if (todayInTz(rec.timeZone) > rec.endDay) throw fail(`${name}'s fifteen days ended on ${fmtDay(rec.endDay)} — homework is set during them`);
    if (day < rec.startDay || day > rec.endDay) {
      throw fail(`Pick a day from ${fmtDay(rec.startDay)} to ${fmtDay(rec.endDay)} — ${name}'s fifteen days`);
    }
    return found;
  }

  /**
   * Replace a homework's question document — at any time, even once answered —
   * or attach one to an answer kept from before questions were required. The
   * joiner is told if the homework is open; an answer already in still counts.
   */
  async setHomeworkQuestion(employeeId: string, itemId: string, userId: string, isHr: boolean, src: NewQuestion) {
    const { rec, emp, viewer } = await this.forReviewer(employeeId, userId, isHr);
    const entry = homeworkEntries(rec, rec.timeZone).find((e) => e.id === itemId);
    if (!entry) throw fail("That homework isn't in their guide", 404);
    const { video } = src;
    if (entry.kind === "video" && !video) throw fail("This homework is a video — replace it with a video");
    if (entry.kind !== "video" && video) throw fail("This homework is a document — replace it with a document");
    if (!src.file && !video?.vimeo) throw fail("Choose the replacement");
    const stored = src.file ? { key: src.file.key, name: src.file.name, at: new Date(), by: userId } : null;
    if (entry.legacy) {
      rec.set(entry.legacy === 1 ? "homework" : "homework2", stored);
    } else {
      const h = rec.homeworks.id(itemId)!;
      // An uploaded video replaces a Vimeo one, or the other way round. A
      // document's question files become just this one.
      h.set("question", stored);
      if (!video) h.set("questionFiles", stored ? [stored] : []);
      h.set("vimeo", video?.vimeo && !stored ? video.vimeo : null);
      // A new video is a different film: it is watched from the start. What
      // they handed in for the old one still counts.
      if (video) { h.set("videoSeconds", Math.round(video.seconds)); h.set("watch", emptyWatch()); }
    }
    await rec.save();
    if (todayInTz(rec.timeZone) >= entry.day) {
      await notify({
        users: [rec.user], kind: "reminder",
        title: video
          ? `The video for “${entry.title}” has been updated`
          : hasQuestion(entry) ? `The question for “${entry.title}” has been updated` : `The question for “${entry.title}” is on file`,
        body: entry.handedIn
          ? video ? "What you handed in still counts. The new video is in your guide." : "What you handed in still counts. If your answer needs changing, upload it again."
          : video ? "Watch it to the end, then write what you learned." : "Upload your answer as a file.",
        href: "/first-days", actor: userId,
      });
    }
    return this.view(rec, emp, viewer);
  }

  /** One of the list's document homework, for the head or HR to change — refused otherwise, saying why. */
  private async reviewerDocument(employeeId: string, itemId: string, userId: string, isHr: boolean) {
    const found = await this.forReviewer(employeeId, userId, isHr);
    const entry = homeworkEntries(found.rec, found.rec.timeZone).find((e) => e.id === itemId);
    if (!entry) throw fail("That homework isn't in their guide", 404);
    if (entry.legacy) throw fail("This homework takes one question file — replace it instead");
    return { ...found, entry };
  }

  /** More question files for a document homework, at any time; the joiner is told if it's open. */
  async addHomeworkFiles(employeeId: string, itemId: string, userId: string, isHr: boolean, files: StoredFile[]) {
    const { rec, emp, viewer, entry } = await this.reviewerDocument(employeeId, itemId, userId, isHr);
    if (entry.kind !== "document") throw fail("A video homework holds one video — put another video in its own homework, in the same folder");
    if (!files.length) throw fail("Choose the files");
    const all = [...entry.questions, ...files.map((f) => stamp(f, userId))];
    if (all.length > MAX_FILES) throw fail(`A homework can have up to ${MAX_FILES} question files — remove one first`);
    const h = rec.homeworks.id(itemId)!;
    h.set("questionFiles", all);
    h.set("question", all[0]);
    await rec.save();
    if (todayInTz(rec.timeZone) >= entry.day) {
      await notify({
        users: [rec.user], kind: "reminder",
        title: `More for “${entry.title}”`,
        body: `${plural(files.length, "new file")} from your department head: ${files.map((f) => f.name).join(", ")}`,
        href: "/first-days", actor: userId,
      });
    }
    return this.view(rec, emp, viewer);
  }

  /** Take a question file back out. One always stays — add the right one, then remove the wrong one. */
  async removeHomeworkFile(employeeId: string, itemId: string, userId: string, isHr: boolean, key: string) {
    const { rec, emp, viewer, entry } = await this.reviewerDocument(employeeId, itemId, userId, isHr);
    if (entry.kind !== "document") throw fail("Replace the video instead");
    const left = entry.questions.filter((f) => f.key !== key);
    if (left.length === entry.questions.length) throw fail("That file isn't in this homework", 404);
    if (!left.length) throw fail("Keep at least one question file — add the new one first, then remove this one");
    const h = rec.homeworks.id(itemId)!;
    h.set("questionFiles", left);
    h.set("question", left[0]);
    await rec.save();
    return this.view(rec, emp, viewer);
  }

  /** Put a homework in a folder — "" takes it out of any. Folders only group the page. */
  async moveHomework(employeeId: string, itemId: string, userId: string, isHr: boolean, folder: string) {
    const { rec, emp, viewer } = await this.reviewerDocument(employeeId, itemId, userId, isHr);
    rec.homeworks.id(itemId)!.set("folder", folderName(folder));
    await rec.save();
    return this.view(rec, emp, viewer);
  }

  /**
   * One homework to several joiners at once, for the same date. Each is
   * checked on its own — a head only reaches their own department's joiners,
   * and the date must fall in that joiner's fifteen days — and one refusal
   * does not stop the rest; the answer says how each went.
   */
  async addHomeworkToMany(employeeIds: string[], userId: string, isHr: boolean, input: NewHomework) {
    const results: { employeeId: string; name: string; ok: boolean; message: string }[] = [];
    for (const employeeId of Array.from(new Set(employeeIds))) {
      try {
        const v = await this.addHomework(employeeId, userId, isHr, input);
        results.push({ employeeId, name: v.employee.name, ok: true, message: "Sent" });
      } catch (e) {
        const emp = await loadEmployee({ _id: employeeId }).catch(() => null);
        results.push({ employeeId, name: emp?.name ?? "Unknown", ok: false, message: e instanceof Error ? e.message : "Could not send" });
      }
    }
    return results;
  }

  /** 3CX and Zoho are HR's to tick; the sales CRM is the head's (or HR's). Unticking is allowed — a mistick happens. */
  async setAccess(employeeId: string, userId: string, isHr: boolean, tool: "threeCx" | "zoho" | "crm", given: boolean) {
    const { rec, emp, viewer } = await this.forReviewer(employeeId, userId, isHr);
    if (tool === "crm") {
      if (!emp.department?.isSales) throw fail("CRM access is a step for sales teams");
    } else if (!isHr) {
      throw fail("3CX and Zoho access are HR's to give", 403);
    }
    rec.set(`access.${tool}`, given ? { at: new Date(), by: userId } : { at: null, by: null });
    await rec.save();
    return this.view(rec, emp, viewer);
  }

  async assignClients(employeeId: string, userId: string, isHr: boolean) {
    const { rec, emp, viewer } = await this.forReviewer(employeeId, userId, isHr);
    if (!emp.department?.isSales) throw fail("Cold calls are a step for sales teams");
    if (!rec.coldCalls?.assignedAt) {
      rec.set("coldCalls.assignedAt", new Date());
      rec.set("coldCalls.assignedBy", userId);
      await rec.save();
      await notify({
        users: [rec.user], kind: "reminder",
        title: "Your default clients are ready",
        body: "They're in the CRM — make your first calls, then mark it done in your guide.",
        href: "/first-days", actor: userId,
      });
    }
    return this.view(rec, emp, viewer);
  }

  // ── The team video, as the head manages it ─────────────────────────────────

  private async assertTeamManager(departmentId: string, userId: string, isHr: boolean) {
    if (isHr) return;
    if (!(await departmentsHeadedBy(userId)).includes(String(departmentId))) {
      throw fail("Only this department's head or HR can manage its team video", 403);
    }
  }

  async teamVideoForDepartment(departmentId: string, userId: string, isHr: boolean) {
    await this.assertTeamManager(departmentId, userId, isHr);
    const video = await TeamVideo.findOne(scoped({ department: departmentId, active: true }))
      .populate<{ uploadedBy: { name?: string } | null }>("uploadedBy", "name")
      .lean();
    return video
      ? {
          _id: video._id, title: video.title, fileName: video.fileName ?? "", durationSeconds: video.durationSeconds,
          url: publicUrl(video.fileKey), uploadedAt: video.createdAt, uploadedBy: video.uploadedBy?.name ?? "",
        }
      : null;
  }

  /** Put up a new team video; the last one is retired, not deleted. */
  async saveTeamVideo(
    departmentId: string, userId: string, isHr: boolean,
    file: { key: string; fileName: string; durationSeconds: number; title?: string }
  ) {
    await this.assertTeamManager(departmentId, userId, isHr);
    await TeamVideo.updateMany(scoped({ department: departmentId, active: true }), { $set: { active: false } });
    await TeamVideo.create({
      organization: getOrgId(), department: departmentId, title: file.title?.trim().slice(0, 160) || "Team video",
      fileKey: file.key, fileName: file.fileName.slice(0, 260), durationSeconds: file.durationSeconds, uploadedBy: userId,
    });
    return this.teamVideoForDepartment(departmentId, userId, isHr);
  }

  /** May this login manage that department's video — checked before a large file is stored. */
  async mayManageTeamVideo(departmentId: string, userId: string, isHr: boolean) {
    await this.assertTeamManager(departmentId, userId, isHr);
  }

  // ── Other portals ──────────────────────────────────────────────────────────

  /**
   * Whether somebody is inside their first fifteen days, by the email they
   * sign in with — so every portal can turn red for them. Found the same way
   * the wallet finds people: work email first, else their login's.
   */
  async forEmail(email: string, organizationId?: string) {
    const address = email.trim().toLowerCase();
    const inOrg = organizationId ? { organization: organizationId } : {};
    const logins = await User.find({ email: address, ...inOrg }).select("_id").lean();
    const candidates = await Employee.find({
      $or: [{ email: address }, ...(logins.length ? [{ user: { $in: logins.map((u) => u._id) } }] : [])],
      ...inOrg,
    }).select("_id organization status").lean<Array<{ _id: unknown; organization?: unknown; status?: string }>>();
    const pick = candidates.find((c) => !hasLeft(c.status)) ?? candidates[0];
    if (!pick) throw fail("No HRMS employee has this email.", 404);

    return new Promise<{ inFirstDays: boolean; day: number | null; of: number; startDay: string | null; endDay: string | null; theme: "red" | null }>((resolve, reject) => {
      runWithOrg({ orgId: pick.organization ? String(pick.organization) : null, isSuperAdmin: false }, () => {
        (async () => {
          const emp = await loadEmployee({ _id: pick._id });
          const rec = await this.ensureFor(emp);
          if (!rec) return { inFirstDays: false, day: null, of: FIRST_DAYS_LENGTH, startDay: null, endDay: null, theme: null };
          const today = todayInTz(rec.timeZone);
          const active = today >= rec.startDay && today <= rec.endDay;
          return {
            inFirstDays: active,
            day: dayNumber(rec.startDay, today),
            of: FIRST_DAYS_LENGTH,
            startDay: rec.startDay,
            endDay: rec.endDay,
            theme: active ? "red" as const : null,
          };
        })().then(resolve, reject);
      });
    });
  }
}
