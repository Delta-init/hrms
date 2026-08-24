"use client";
import { motion } from "framer-motion";
import { CalendarCheck, Clock3, AlertTriangle, Timer, PartyPopper, CalendarClock, ArrowUpRight, ClipboardList, Loader2, Cake, Award, Megaphone, Pin } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useMyAttendance } from "@/hooks/useSelfAttendance";
import { useMyLeaves, useHolidays } from "@/hooks/useLeaves";
import { useMyOnboardingChecklist, useSetMyOnboardingTaskStatus } from "@/hooks/useOnboardingChecklists";
import { useDashboardWishes } from "@/hooks/useDashboard";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { ClockCard } from "@/components/dashboard/ClockCard";
import { AttendanceHistoryChart } from "@/components/dashboard/AttendanceHistoryChart";
import { HrDashboard } from "@/components/dashboard/HrDashboard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { LEAVE_TYPE_LABELS, ANNOUNCEMENT_CATEGORY_LABELS, type LeaveStatus, leaveTypeLabel } from "@/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } } };

const monthStartISO = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(iso));
const leaveStatusStyle: Record<LeaveStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600", approved: "bg-emerald-500/10 text-emerald-600",
  rejected: "bg-red-500/10 text-red-600", cancelled: "bg-muted text-muted-foreground",
};

export default function DashboardPage() {
  const { user, hasPermission } = useAuth();
  // HR / managers get the team overview (and no clock-in card); everyone else
  // gets the personal self-service dashboard.
  const isManager = hasPermission("leave", "approve") || hasPermission("employees", "view");
  if (isManager) return <HrDashboard />;

  return <EmployeeDashboard />;
}

function EmployeeDashboard() {
  const { user } = useAuth();
  const { data: attData } = useMyAttendance({ dateFrom: monthStartISO(), dateTo: todayISO(), limit: "100" });
  const { data: myLeaves } = useMyLeaves({ limit: "5" });
  const { data: holidayData } = useHolidays({ dateFrom: todayISO(), limit: "6" });
  const { data: wishes } = useDashboardWishes();
  const { data: announcementsData } = useAnnouncements({ limit: "3" });
  const announcements = announcementsData?.data ?? [];
  const wishCount = (wishes?.birthdays.length ?? 0) + (wishes?.anniversaries.length ?? 0);

  const recs = attData?.data ?? [];
  const present = recs.filter((r) => r.status === "present").length;
  const late = recs.filter((r) => r.status === "late").length;
  const half = recs.filter((r) => r.status === "half_day").length;
  const workedH = Math.round(recs.reduce((a, r) => a + r.workedMinutes, 0) / 60);
  const leaves = myLeaves?.data ?? [];
  const holidays = holidayData?.data ?? [];

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date());
  const firstName = user?.name?.split(" ")[0] ?? "there";

  const stats = [
    // Every one of these counts a slice of this month's attendance, so each is
    // a question ("which days was I late?") that only the attendance page can
    // answer. They looked like cards you could press and did nothing.
    { label: "Present", value: present, icon: CalendarCheck, tint: "text-emerald-600 bg-emerald-500/10", href: "/attendance" },
    { label: "Late", value: late, icon: Clock3, tint: "text-amber-600 bg-amber-500/10", href: "/attendance" },
    { label: "Half Days", value: half, icon: AlertTriangle, tint: "text-red-600 bg-red-500/10", href: "/attendance" },
    { label: "Hours (mo)", value: workedH, icon: Timer, tint: "text-primary bg-primary/10", href: "/attendance" },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left / main */}
      <div className="space-y-6 lg:col-span-2">
        {/* Greeting hero */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-indigo-600 to-indigo-800 p-7 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-56 w-56 rounded-full bg-white/5" />
          <p className="text-sm text-white/70">{today}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Hi, {firstName} 👋</h1>
          <p className="mt-1 max-w-md text-sm text-white/70">Clock in for the day and keep track of your attendance & leave.</p>
        </motion.div>

        {/* Stats */}
        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s) => (
            <motion.div key={s.label} variants={item}>
              <Link href={s.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl">
                <Card className="p-5 transition-colors hover:border-primary/40 hover:bg-muted/40">
                  <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-xl", s.tint)}><s.icon className="h-5 w-5" /></div>
                  <p className="text-2xl font-bold tracking-tight">{s.value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
                </Card>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* Team wishes — today's birthdays & work anniversaries (hidden when there's nothing to celebrate) */}
        {wishCount > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2"><PartyPopper className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Today&apos;s Wishes</h3></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {wishes?.birthdays.map((b) => (
                <div key={`bday-${b._id}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-500/10 text-pink-600"><Cake className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{b.name}</p><p className="truncate text-xs text-muted-foreground">Birthday today 🎂</p></div>
                </div>
              ))}
              {wishes?.anniversaries.map((a) => (
                <div key={`anniv-${a._id}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600"><Award className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.name}</p><p className="truncate text-xs text-muted-foreground">{a.years} {a.years === 1 ? "year" : "years"} today 🎉</p></div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Announcements */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Announcements</h3></div>
            <Link href="/announcements" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {announcements.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No announcements yet.</p>
          ) : (
            <div className="space-y-2">
              {announcements.map((a) => (
                <div key={a._id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    {a.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <Badge variant="secondary" className="ml-auto shrink-0 capitalize">{ANNOUNCEMENT_CATEGORY_LABELS[a.category]}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* My onboarding tasks (new hires only — hidden once nothing is assigned to them) */}
        <MyOnboardingTasksCard />

        {/* Chart + Upcoming holidays (right of chart). Flex-wrap based on the
            row's own available width, not the viewport — this row lives inside
            an already-narrowed lg:col-span-2 column, so a viewport breakpoint
            (e.g. xl:grid-cols-3) fires "wide enough" way before this row
            actually has room, squeezing the holidays card down to a sliver. */}
        <div className="flex flex-wrap gap-6">
          <div className="min-w-[260px] flex-[2_1_320px]"><AttendanceHistoryChart /></div>
          <Card className="min-w-[260px] flex-[1_1_260px] p-5">
            <div className="mb-3 flex items-center gap-2"><PartyPopper className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Upcoming Holidays</h3></div>
            {holidays.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No upcoming holidays.</p>
            ) : (
              <div className="space-y-2">
                {holidays.map((h) => (
                  <div key={h._id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600"><PartyPopper className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{h.name}</p><p className="text-xs capitalize text-muted-foreground">{h.type}</p></div>
                    <span className="text-xs font-medium text-muted-foreground">{fmtDate(h.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* My leave */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">My Recent Leave</h3></div>
            <Link href="/leave" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {leaves.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No leave requests yet. <Link href="/leave" className="font-medium text-primary hover:underline">Apply for leave</Link></p>
          ) : (
            <div className="space-y-2">
              {leaves.map((l) => (
                <div key={l._id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarClock className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{leaveTypeLabel(l.type)} · {l.days} day{l.days === 1 ? "" : "s"}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", leaveStatusStyle[l.status])}>{l.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Right rail — the clock */}
      <div className="lg:sticky lg:top-2 lg:self-start">
        <ClockCard />
      </div>
    </div>
  );
}

function MyOnboardingTasksCard() {
  const { data: checklist, isLoading } = useMyOnboardingChecklist();
  const { mutate: setStatus, isPending } = useSetMyOnboardingTaskStatus();

  const myTasks = (checklist?.tasks ?? []).filter((t) => t.assigneeRole === "employee");
  if (isLoading || myTasks.length === 0) return null;
  const done = myTasks.filter((t) => t.status === "completed").length;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">My Onboarding Tasks</h3></div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">{done}/{myTasks.length} done</span>
          <Link href="/onboarding-tasks" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
      </div>
      <div className="space-y-2">
        {myTasks.map((t) => (
          <div key={t._id} className={cn("flex items-start gap-3 rounded-lg border border-border p-2.5", t.status === "completed" && "bg-muted/30")}>
            <Checkbox
              checked={t.status === "completed"}
              disabled={isPending}
              onCheckedChange={(checked) => setStatus({ taskId: t._id, status: checked ? "completed" : "pending" })}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", t.status === "completed" && "text-muted-foreground line-through")}>{t.title}</p>
              {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
            </div>
            {isPending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          </div>
        ))}
      </div>
    </Card>
  );
}
