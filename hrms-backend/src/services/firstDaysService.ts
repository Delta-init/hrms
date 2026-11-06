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
  FIRST_DAYS_LENGTH, ROLE_PLAY_OPENS_AT, SESSION_ENDS_AT,
  addDays, dayNumber, isChatGptShareLink, joiningDayKey, lastRedDay, workingDayKeys,
} from "../utils/firstDays.js";
import { applyBeat, watchProgress, type WatchState } from "../utils/watchSpans.js";
import { env } from "../config/env.js";

/**
 * A new joiner's first fifteen days: a red portal, and the steps of days 1 to
 * 3 laid out for them, their department head and HR.
 *
 * Day 1 — the induction video (done when watched), the 10:30–1 pm session
 * (done when both the joiner and the head confirm it), and the homework the
 * head sends. Day 2 — the homework handed back, the team's video watched, and
 * for sales teams a ChatGPT role-play with the chat's link. Day 3 — 3CX and
 * Zoho from HR, and for sales teams the CRM from the head and the first cold
 * calls on the team's default clients.
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

export type StepKey = "induction" | "session" | "homework" | "homeworkResult" | "teamVideo" | "rolePlay" | "access" | "coldCalls";
export type StepStatus = "done" | "todo" | "waiting" | "overdue";

/** Who is looking — what they may do follows from it. */
export interface Viewer { userId: string; isJoiner: boolean; isHead: boolean; isHr: boolean }

type Rec = InstanceType<typeof FirstDays>;
type EmployeeLite = {
  _id: unknown; name?: string; employeeCode?: string; designation?: string; user?: unknown;
  joiningDate?: Date | null; status?: string; workMode?: "office" | "wfh" | null;
  workSchedule?: { _id: unknown; timeZone?: string; workDays?: number[] } | null;
  department?: { _id: unknown; name?: string; isSales?: boolean } | null;
};

const EMPLOYEE_FIELDS = "name employeeCode designation user joiningDate status workMode workSchedule department";
const loadEmployee = (filter: Record<string, unknown>) =>
  Employee.findOne(scoped(filter))
    .select(EMPLOYEE_FIELDS)
    .populate("workSchedule", "timeZone workDays name loginTime logoutTime halfDays mode requiredHours")
    .populate("department", "name isSales")
    .lean<EmployeeLite | null>();

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
const fileOut = (f: { key?: string | null; name?: string | null; at?: Date | null } | null | undefined) =>
  f?.key ? { name: f.name || "File", url: publicUrl(f.key), at: f.at ?? null } : null;

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
      .populate("department", "name isSales")
      .lean<EmployeeLite[]>();
    let started = 0;
    for (const emp of due) {
      const had = await FirstDays.exists(scoped({ employee: emp._id }));
      if ((await this.ensureFor(emp)) && !had) started++;
    }
    return { started };
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
      body: "Their day-1 session runs 10:30 to 1 pm — confirm it afterwards, then send their homework.",
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
        key: "homework" as StepKey, day: 1, dueDay: d1,
        title: "Homework from your department head",
        detail: "Your head sends it as a file after the session. Hand it back tomorrow.",
        status: status(!!rec.homework?.key, d1, false),
        file: fileOut(rec.homework),
        can: asHead && !rec.homeworkResult?.key ? [rec.homework?.key ? "replace" : "send"] : [],
      },
      {
        key: "homeworkResult" as StepKey, day: 2, dueDay: d2,
        title: "Hand in your homework",
        detail: "Upload what you did as a file.",
        status: status(!!rec.homeworkResult?.key, d2, !rec.homework?.key),
        waitingFor: rec.homework?.key ? null : "the homework from your department head",
        file: fileOut(rec.homeworkResult),
        can: viewer.isJoiner && rec.homework?.key ? [rec.homeworkResult?.key ? "replace" : "upload"] : [],
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

    const doneCount = steps.filter((s) => s.status === "done").length;
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
      stepDays: [d1, d2, d3],
      steps,
      doneCount,
      totalCount: steps.length,
      complete: doneCount === steps.length,
      viewer: { isJoiner: viewer.isJoiner, isHead: viewer.isHead, isHr: viewer.isHr },
    };
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
          body: "Confirm it on your side too, then send their homework.",
          href: "/first-days/team",
          actor: userId,
        });
      }
    }
    return this.mineView(userId);
  }

  async handInHomework(userId: string, file: { key: string; name: string }) {
    const { rec, emp } = await this.mineOrFail(userId);
    if (!rec.homework?.key) throw fail("Your homework hasn't been sent yet");
    rec.set("homeworkResult", { key: file.key, name: file.name, at: new Date(), by: userId });
    await rec.save();
    await notify({
      users: (await headContactsFor(userId)).map((h) => h.userId),
      kind: "reminder",
      title: `${emp.name ?? "Your new joiner"} handed in their homework`,
      body: file.name,
      href: "/first-days/team",
      actor: userId,
    });
    return this.mineView(userId);
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

  async sendHomework(employeeId: string, userId: string, isHr: boolean, file: { key: string; name: string }) {
    const { rec, emp, viewer } = await this.forReviewer(employeeId, userId, isHr);
    if (rec.homeworkResult?.key) throw fail("They've already handed it in");
    rec.set("homework", { key: file.key, name: file.name, at: new Date(), by: userId });
    await rec.save();
    await notify({
      users: [rec.user], kind: "reminder",
      title: "Your homework is here",
      body: `Hand it in by ${fmtDay(rec.stepDays[1] ?? rec.startDay)} — upload what you did as a file.`,
      href: "/first-days", actor: userId,
    });
    return this.view(rec, emp, viewer);
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
