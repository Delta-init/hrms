"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { UserCheck, Clock3, Plane, UserX, Home, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Attendance, AttendanceStatus } from "@/types";

/** Small rAF count-up used on each stat number. */
function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  useEffect(() => {
    fromRef.current = val;
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(fromRef.current + (target - fromRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Fallback: rAF is paused in background/hidden tabs and disabled for
    // reduced-motion users — guarantee the final value is shown regardless.
    const settle = setTimeout(() => setVal(target), duration + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);
  return val;
}

function StatCard({
  icon: Icon, label, value, suffix, tone, delay, decimals = 0,
}: {
  icon: React.ElementType; label: string; value: number; suffix?: string;
  tone: { text: string; bg: string; ring: string; glow: string }; delay: number; decimals?: number;
}) {
  const shown = useCountUp(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className="group relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-lg"
    >
      {/* soft glow that blooms on hover */}
      <div className={cn("pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100", tone.glow)} />
      <div className="relative flex items-center justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl ring-1", tone.bg, tone.ring, tone.text)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="relative mt-3">
        <div className="flex items-baseline gap-1">
          <span className={cn("text-2xl font-bold tabular-nums tracking-tight", tone.text)}>
            {shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
          </span>
          {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
        </div>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
      </div>
    </motion.div>
  );
}

const TONES = {
  emerald: { text: "text-emerald-600", bg: "bg-emerald-500/10", ring: "ring-emerald-500/20", glow: "bg-emerald-400/30" },
  amber: { text: "text-amber-600", bg: "bg-amber-500/10", ring: "ring-amber-500/20", glow: "bg-amber-400/30" },
  violet: { text: "text-violet-600", bg: "bg-violet-500/10", ring: "ring-violet-500/20", glow: "bg-violet-400/30" },
  rose: { text: "text-rose-600", bg: "bg-rose-500/10", ring: "ring-rose-500/20", glow: "bg-rose-400/30" },
  sky: { text: "text-sky-600", bg: "bg-sky-500/10", ring: "ring-sky-500/20", glow: "bg-sky-400/30" },
  primary: { text: "text-primary", bg: "bg-primary/10", ring: "ring-primary/20", glow: "bg-primary/30" },
};

export function AttendanceStatsBar({ records, loading }: { records: Attendance[]; loading?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const by = (s: AttendanceStatus) => records.filter((r) => r.status === s).length;
  const present = by("present") + by("wfh");
  const late = by("late") + by("half_day");
  const onLeave = by("on_leave");
  const absent = by("absent");
  const wfh = by("wfh");
  const totalWorked = records.reduce((a, r) => a + (r.workedMinutes || 0), 0);
  const withHours = records.filter((r) => (r.workedMinutes || 0) > 0).length;
  const avgHours = withHours > 0 ? totalWorked / withHours / 60 : 0;

  const cards = [
    { icon: UserCheck, label: "Present today", value: present, tone: TONES.emerald },
    { icon: Clock3, label: "Late / half-day", value: late, tone: TONES.amber },
    { icon: Plane, label: "On leave", value: onLeave, tone: TONES.violet },
    { icon: UserX, label: "Absent", value: absent, tone: TONES.rose },
    { icon: Home, label: "Working remote", value: wfh, tone: TONES.sky },
    { icon: Timer, label: "Avg hours", value: avgHours, tone: TONES.primary, suffix: "h", decimals: 1 },
  ];

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <h2 className="text-sm font-semibold">Today at a glance</h2>
        </div>
        {now && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(now)}
            {" · "}
            <span className="font-medium text-foreground">
              {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now)}
            </span>
          </p>
        )}
      </div>
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6", loading && "opacity-60")}>
        {cards.map((c, i) => (
          <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} suffix={c.suffix} decimals={c.decimals} tone={c.tone} delay={i * 0.06} />
        ))}
      </div>
    </div>
  );
}
