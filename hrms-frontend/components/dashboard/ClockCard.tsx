"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlarmClock, Fingerprint, Power, Sunrise, Sunset, Lock, CheckCircle2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTodayAttendance, useClockIn, useClockOut } from "@/hooks/useSelfAttendance";

type Tone = "neutral" | "green" | "amber" | "red" | "primary";
const TONES: Record<Tone, { glow: string; text: string; badge: string; stroke: string }> = {
  neutral: { glow: "bg-slate-400/30", text: "text-slate-500", badge: "bg-slate-500/10 text-slate-600 border-slate-500/20", stroke: "#94a3b8" },
  green: { glow: "bg-emerald-400/50", text: "text-emerald-600", badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", stroke: "#10b981" },
  amber: { glow: "bg-amber-400/50", text: "text-amber-600", badge: "bg-amber-500/10 text-amber-600 border-amber-500/20", stroke: "#f59e0b" },
  red: { glow: "bg-red-500/50", text: "text-red-600", badge: "bg-red-500/10 text-red-600 border-red-500/20", stroke: "#ef4444" },
  primary: { glow: "bg-primary/50", text: "text-primary", badge: "bg-primary/10 text-primary border-primary/20", stroke: "#4f46e5" },
};

function fmtTime(iso?: string | null, tz?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz, hour12: true }).format(new Date(iso)).toLowerCase();
}
function fmtClock(d: Date, tz?: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz, hour12: true }).format(d);
}
function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function ClockCard() {
  const { data, isLoading } = useTodayAttendance();
  const { mutate: clockIn, isPending: clockingIn } = useClockIn();
  const { mutate: clockOut, isPending: clockingOut } = useClockOut();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (isLoading || !data) {
    return <Card className="flex h-full min-h-[360px] items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  }

  const { attendance, schedule, shift } = data;
  const tz = schedule.timeZone;
  const t = now.getTime();
  const windowOpen = new Date(shift.windowOpen).getTime();
  const lateAt = new Date(shift.lateThreshold).getTime();
  const halfAt = new Date(shift.halfDayThreshold).getTime();

  // Resolve current phase → tone, label, action.
  let tone: Tone = "primary";
  let title = "";
  let sub = "";
  let action: (() => void) | null = null;
  let actionLabel = "";
  let ActionIcon = AlarmClock;
  let pulse = false;
  const busy = clockingIn || clockingOut;

  if (attendance?.checkOut) {
    tone = attendance.status === "half_day" ? "red" : attendance.status === "late" ? "amber" : "green";
    title = "Shift complete";
    sub = `Worked ${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m`;
    actionLabel = "Done"; ActionIcon = CheckCircle2;
  } else if (attendance?.checkIn) {
    tone = attendance.status === "half_day" ? "red" : attendance.status === "late" ? "amber" : "green";
    title = "Clocked in";
    sub = `Elapsed ${fmtDuration(t - new Date(attendance.checkIn).getTime())}`;
    action = () => clockOut(); actionLabel = "Clock Out"; ActionIcon = Power; pulse = true;
  } else if (t < windowOpen) {
    tone = "neutral";
    title = "Not open yet";
    sub = `Opens at ${fmtTime(shift.windowOpen, tz)}`;
    actionLabel = "Locked"; ActionIcon = Lock;
  } else {
    // ready to clock in
    if (t <= lateAt) { tone = "green"; sub = "You're on time"; }
    else if (t <= halfAt) { tone = "amber"; sub = "You're running late"; }
    else { tone = "red"; sub = "Late — counts as half day"; }
    title = "Ready to clock in";
    action = () => clockIn(); actionLabel = "Clock In"; ActionIcon = Fingerprint; pulse = true;
  }

  const c = TONES[tone];
  const statusLabel = attendance ? (attendance.status === "half_day" ? "Half Day" : attendance.status === "late" ? "Late" : attendance.status === "present" ? "Present" : attendance.status) : "Not clocked in";

  // Radial progress = fraction of the shift elapsed.
  const shiftStartMs = new Date(shift.shiftStart).getTime();
  const shiftEndMs = new Date(shift.shiftEnd).getTime();
  const progress = Math.max(0, Math.min(1, (t - shiftStartMs) / (shiftEndMs - shiftStartMs || 1)));
  const R = 45, CIRC = 2 * Math.PI * R;

  return (
    <Card className="flex h-full flex-col p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">Daily Attendance</h3>
          <p className="text-sm text-muted-foreground">{schedule.loginTime}–{schedule.logoutTime} · {tz}</p>
        </div>
        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", c.badge)}>{statusLabel}</span>
      </div>

      {/* live current time */}
      <p className="mt-1 text-center font-mono text-2xl font-bold tabular-nums tracking-tight">{fmtClock(now, tz)}</p>

      {/* big animated clock button */}
      <div className="flex flex-1 items-center justify-center py-4">
        <button
          type="button"
          onClick={() => action?.()}
          disabled={!action || busy}
          className={cn("group relative flex h-40 w-40 items-center justify-center rounded-full transition-transform", action && !busy ? "cursor-pointer active:scale-95" : "cursor-default")}
        >
          {/* pulsing glow */}
          <motion.span aria-hidden className={cn("absolute -inset-3 rounded-full opacity-60 blur-xl", c.glow)}
            animate={pulse ? { scale: [1, 1.12, 1], opacity: [0.45, 0.7, 0.45] } : {}} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />

          {/* radial progress ring */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/60" />
            <motion.circle
              cx="50" cy="50" r={R} fill="none" stroke={c.stroke} strokeWidth="6.5" strokeLinecap="round"
              strokeDasharray={CIRC}
              initial={false}
              animate={{ strokeDashoffset: CIRC * (1 - progress) }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </svg>

          {/* inner face */}
          <span className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-background shadow-inner">
            {busy ? (
              <Loader2 className={cn("h-10 w-10 animate-spin", c.text)} />
            ) : (
              <motion.span
                animate={pulse ? { scale: [1, 1.14, 1], y: [0, -1, 0] } : {}}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="transition-transform group-hover:scale-110"
              >
                <ActionIcon className={cn("h-10 w-10", c.text)} strokeWidth={2.2} />
              </motion.span>
            )}
            <span className={cn("mt-1.5 text-sm font-semibold", c.text)}>{actionLabel}</span>
          </span>
        </button>
      </div>

      <p className={cn("text-center text-sm font-medium", c.text)}>{title}</p>
      <p className="text-center text-xs text-muted-foreground">{sub}</p>

      {/* in / out chips */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Sunrise className="h-4 w-4 text-amber-500" />Clock-in</p>
          <p className="mt-1 text-base font-semibold tabular-nums">{fmtTime(attendance?.checkIn, tz)}</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Sunset className="h-4 w-4 text-rose-500" />Clock-out</p>
          <p className="mt-1 text-base font-semibold tabular-nums">{fmtTime(attendance?.checkOut, tz)}</p>
        </div>
      </div>
    </Card>
  );
}
