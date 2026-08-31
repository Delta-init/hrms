"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Cake, Plane, CalendarClock, ClipboardCheck, ArrowUpRight, PartyPopper, LogOut, FileWarning, Home, Award, Megaphone, Pin,
  ShieldCheck, UserPlus, UserMinus,
} from "lucide-react";
import { useDashboardSummary } from "@/hooks/useDashboard";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getInitials, cn } from "@/lib/utils";
import { ConfirmationDialog } from "@/components/confirmations/ConfirmationDialog";
import { ApprovalsCard } from "@/components/dashboard/ApprovalsCard";
import {
  LEAVE_TYPE_LABELS, REGULARIZATION_TYPE_LABELS, ANNOUNCEMENT_CATEGORY_LABELS,
  type LeaveLite, type RegularizationLite, type DueConfirmation, leaveTypeLabel } from "@/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } } };
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(iso));
const nameOf = (u?: { name: string } | string | null) => (u && typeof u === "object" ? u.name : "—");
/** "2 days ago" / "today" for a past date. */
const daysAgo = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
};

export function HrDashboard() {
  const { user } = useAuth();
  const [confirmTarget, setConfirmTarget] = useState<DueConfirmation | null>(null);
  const { data, isLoading } = useDashboardSummary();
  const { data: announcementsData } = useAnnouncements({ limit: "5" });
  const announcements = announcementsData?.data ?? [];
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const c = data?.counts ?? {
    birthdays: 0, anniversaries: 0, onLeaveToday: 0, workingFromHomeToday: 0, pendingLeaves: 0,
    pendingRegularizations: 0, servingNotice: 0, expiringDocuments: 0,
    upcomingBirthdays: 0, upcomingAnniversaries: 0, newJoiners: 0, recentResignations: 0, dueConfirmations: 0,
  };

  const stats = [
    { label: "Birthdays today", value: c.birthdays, icon: Cake, tint: "text-pink-600 bg-pink-500/10", href: undefined },
    { label: "On leave today", value: c.onLeaveToday, icon: Plane, tint: "text-violet-600 bg-violet-500/10", href: "/leave" },
    { label: "Working from home", value: c.workingFromHomeToday, icon: Home, tint: "text-teal-600 bg-teal-500/10", href: "/attendance" },
    { label: "Pending leave", value: c.pendingLeaves, icon: CalendarClock, tint: "text-amber-600 bg-amber-500/10", href: "/leave" },
    { label: "Pending regularizations", value: c.pendingRegularizations, icon: ClipboardCheck, tint: "text-sky-600 bg-sky-500/10", href: "/regularization" },
    { label: "Docs expiring", value: c.expiringDocuments, icon: FileWarning, tint: "text-rose-600 bg-rose-500/10", href: "/documents?status=expiring&within=60" },
    { label: "Serving notice", value: c.servingNotice, icon: LogOut, tint: "text-orange-600 bg-orange-500/10", href: "/resignations" },
    { label: "Confirmation due", value: c.dueConfirmations, icon: ShieldCheck, tint: "text-emerald-600 bg-emerald-500/10", href: undefined },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting hero */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-indigo-600 to-indigo-800 p-7 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 right-24 h-56 w-56 rounded-full bg-white/5" />
        <p className="text-sm text-white/70">{today}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Hi, {firstName} 👋</h1>
        <p className="mt-1 max-w-md text-sm text-white/70">Here&apos;s what needs your attention across the team today.</p>
      </motion.div>

      {/* Stat tiles */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-8">
        {stats.map((s) => {
          const body = (
            <Card className={cn("group p-5 transition-shadow", s.href && "cursor-pointer hover:shadow-lg")}>
              <div className="flex items-center justify-between">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", s.tint)}><s.icon className="h-5 w-5" /></div>
                {s.href && <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{isLoading ? "—" : s.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
            </Card>
          );
          return <motion.div key={s.label} variants={item}>{s.href ? <Link href={s.href}>{body}</Link> : body}</motion.div>;
        })}
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Everything waiting on management, across every organisation.
            Renders nothing for anyone but a Super Admin — the card knows. */}
        <ApprovalsCard />

        {/* Confirmation due — probation ending */}
        <Panel icon={ShieldCheck} title="Confirmation due (next month)" tint="text-emerald-600">
          {data?.dueConfirmations?.length ? (
            <div className="space-y-2">
              {data.dueConfirmations.map((c) => (
                <button
                  key={c.employee._id}
                  type="button"
                  onClick={() => !c.pendingId && setConfirmTarget(c)}
                  disabled={!!c.pendingId}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors enabled:hover:border-primary/40 enabled:hover:bg-muted/40 disabled:cursor-default"
                >
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    c.overdue ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600")}>
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.employee.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.employee.designation, c.employee.employeeCode].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {c.pendingId ? (
                    <Badge variant="secondary">Awaiting approval</Badge>
                  ) : (
                    <span className={cn("shrink-0 text-xs font-medium", c.overdue ? "text-destructive" : "text-muted-foreground")}>
                      {c.overdue ? `${Math.abs(c.daysLeft)}d overdue` : `in ${c.daysLeft} days`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : <Empty text="No confirmations due." />}
        </Panel>

        {/* Birthdays — next month */}
        <Panel icon={PartyPopper} title="Birthdays (next month)" tint="text-pink-600">
          {data?.upcomingBirthdays?.length ? (
            <div className="space-y-2">
              {data.upcomingBirthdays.slice(0, 8).map((b) => (
                <div key={b._id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-500/10 text-pink-600"><Cake className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${b._id}`} className="truncate text-sm font-medium hover:text-primary hover:underline">{b.name}</Link>
                    <p className="truncate text-xs text-muted-foreground">{[b.designation, b.department].filter(Boolean).join(" · ") || b.employeeCode}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{b.daysUntil === 0 ? "Today 🎂" : `in ${b.daysUntil}d`}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="No birthdays in the next month." />}
        </Panel>

        {/* Work anniversaries — next week */}
        <Panel icon={Award} title="Work anniversaries (this week)" tint="text-amber-600">
          {data?.upcomingAnniversaries?.length ? (
            <div className="space-y-2">
              {data.upcomingAnniversaries.map((a) => (
                <div key={a._id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600"><Award className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${a._id}`} className="truncate text-sm font-medium hover:text-primary hover:underline">{a.name}</Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.daysUntil === 0 ? "Today" : `in ${a.daysUntil}d`}
                      {a.designation ? ` · ${a.designation}` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary">{a.years} {a.years === 1 ? "year" : "years"}</Badge>
                </div>
              ))}
            </div>
          ) : <Empty text="No anniversaries this week." />}
        </Panel>

        {/* New joiners */}
        <Panel icon={UserPlus} title="New joiners (last month)" tint="text-sky-600" href="/employees">
          {data?.newJoiners?.length ? (
            <div className="space-y-2">
              {data.newJoiners.slice(0, 8).map((j) => (
                <div key={j._id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600"><UserPlus className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${j._id}`} className="truncate text-sm font-medium hover:text-primary hover:underline">{j.name}</Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[j.designation, typeof j.department === "object" ? j.department?.name : null].filter(Boolean).join(" · ") || j.employeeCode}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{daysAgo(j.joiningDate)}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="No new joiners this month." />}
        </Panel>

        {/* Resigned */}
        <Panel icon={UserMinus} title="Resigned (last month)" tint="text-rose-600" href="/resignations">
          {data?.recentResignations?.length ? (
            <div className="space-y-2">
              {data.recentResignations.slice(0, 8).map((r) => {
                const emp = typeof r.employee === "object" ? r.employee : null;
                return (
                  <div key={r._id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-600"><UserMinus className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{emp?.name ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">{[emp?.designation, emp?.employeeCode].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{daysAgo(r.resignationDate)}</span>
                  </div>
                );
              })}
            </div>
          ) : <Empty text="No resignations this month." />}
        </Panel>

        {/* On leave today */}
        <Panel icon={Plane} title="On leave today" tint="text-violet-600" href="/leave">
          {data?.onLeaveToday.length ? (
            <div className="space-y-2">{data.onLeaveToday.map((l) => <PersonRow key={l._id} name={nameOf(l.user)} sub={`${leaveTypeLabel(l.type)} · until ${fmtDate(l.endDate)}`} tint="bg-violet-500/10 text-violet-600" icon={Plane} />)}</div>
          ) : <Empty text="Everyone's in today." />}
        </Panel>

        {/* Working from home today */}
        <Panel icon={Home} title="Working from home" tint="text-teal-600" href="/attendance">
          {data?.workingFromHomeToday.length ? (
            <div className="space-y-2">{data.workingFromHomeToday.map((l) => <PersonRow key={l._id} name={nameOf(l.user)} sub={`Until ${fmtDate(l.endDate)}`} tint="bg-teal-500/10 text-teal-600" icon={Home} />)}</div>
          ) : <Empty text="Nobody is working from home today." />}
        </Panel>

        {/* Pending leave approvals */}
        <Panel icon={CalendarClock} title="Pending leave approvals" tint="text-amber-600" href="/leave">
          {data?.pendingLeaves.length ? (
            <div className="space-y-2">{data.pendingLeaves.map((l: LeaveLite) => (
              <PersonRow key={l._id} name={nameOf(l.user)} sub={`${leaveTypeLabel(l.type)} · ${fmtDate(l.startDate)}→${fmtDate(l.endDate)} · ${l.days}d`} tint="bg-amber-500/10 text-amber-600" icon={CalendarClock} badge="pending" />
            ))}</div>
          ) : <Empty text="No leave awaiting approval." />}
        </Panel>

        {/* Pending regularizations */}
        <Panel icon={ClipboardCheck} title="Pending regularizations" tint="text-sky-600" href="/regularization">
          {data?.pendingRegularizations.length ? (
            <div className="space-y-2">{data.pendingRegularizations.map((r: RegularizationLite) => (
              <PersonRow key={r._id} name={nameOf(r.user)} sub={`${REGULARIZATION_TYPE_LABELS[r.type]} · ${fmtDate(r.date)}`} tint="bg-sky-500/10 text-sky-600" icon={ClipboardCheck} badge="pending" />
            ))}</div>
          ) : <Empty text="No corrections awaiting review." />}
        </Panel>

        {/* Document expiry */}
        <Panel icon={FileWarning} title="Document expiry" tint="text-rose-600" href="/employees">
          {data?.expiringDocuments?.length ? (
            <div className="space-y-2">{data.expiringDocuments.map((d, i) => (
              <div key={`${d.employee._id}-${d.type}-${i}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", d.expired ? "bg-red-500/10 text-red-600" : "bg-rose-500/10 text-rose-600")}><FileWarning className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <Link href={`/employees/${d.employee._id}`} className="truncate text-sm font-medium hover:text-primary hover:underline">{d.employee.name}</Link>
                  <p className="truncate text-xs text-muted-foreground">{d.label} · {fmtDate(d.expiryDate)}</p>
                </div>
                <Badge variant="secondary" className={cn("capitalize", d.expired ? "bg-red-500/10 text-red-600" : d.daysLeft <= 30 ? "bg-amber-500/10 text-amber-600" : "")}>
                  {d.expired ? `expired ${Math.abs(d.daysLeft)}d` : `${d.daysLeft}d left`}
                </Badge>
              </div>
            ))}</div>
          ) : <Empty text="No documents expiring soon." />}
        </Panel>

        {/* Serving notice */}
        <Panel icon={LogOut} title="Serving notice" tint="text-orange-600" href="/resignations">
          {data?.servingNotice?.length ? (
            <div className="space-y-2">{data.servingNotice.map((n) => {
              const left = Math.ceil((new Date(n.lastWorkingDay).getTime() - Date.now()) / 86400000);
              return <PersonRow key={n._id} name={nameOf(n.employee)} sub={`Last day ${fmtDate(n.lastWorkingDay)} · ${left > 0 ? `${left}d left` : "due"}`} tint="bg-orange-500/10 text-orange-600" icon={LogOut} badge={left <= 7 ? "soon" : undefined} />;
            })}</div>
          ) : <Empty text="Nobody is serving notice." />}
        </Panel>

        {/* Announcements — full width */}
        <div className="lg:col-span-2">
          <Panel icon={Megaphone} title="Announcements" tint="text-indigo-600" href="/announcements">
            {announcements.length ? (
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
            ) : <Empty text="No announcements yet." />}
          </Panel>
        </div>
      </div>

      <ConfirmationDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        due={confirmTarget}
      />
    </div>
  );
}

function Panel({ icon: Icon, title, tint, href, children }: {
  icon: React.ElementType; title: string; tint: string; href?: string; children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", tint)} /><h3 className="text-sm font-semibold">{title}</h3></div>
        {href && <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>}
      </div>
      {children}
    </Card>
  );
}

function PersonRow({ name, sub, tint, icon: Icon, badge }: {
  name: string; sub: string; tint: string; icon: React.ElementType; badge?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-2.5">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", tint)}>{getInitials(name)}</div>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-muted-foreground">{sub}</p></div>
      {badge && <Badge variant="secondary" className="capitalize">{badge}</Badge>}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
