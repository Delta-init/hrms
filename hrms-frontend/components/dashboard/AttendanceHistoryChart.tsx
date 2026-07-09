"use client";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useMyAttendance } from "@/hooks/useSelfAttendance";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Deepening indigo shades (like the reference).
const SHADES = ["bg-indigo-200", "bg-indigo-300", "bg-indigo-400", "bg-indigo-500", "bg-indigo-600", "bg-indigo-700"];

function lastSixMonths() {
  const out: { key: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[m.getMonth()] });
  }
  return out;
}

export function AttendanceHistoryChart() {
  const months = useMemo(lastSixMonths, []);
  const fromISO = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 5, 1); return d.toISOString().slice(0, 10); }, []);
  const { data } = useMyAttendance({ dateFrom: fromISO, limit: "500" });

  const bars = useMemo(() => {
    const recs = data?.data ?? [];
    const map = new Map(months.map((m) => [m.key, 0]));
    for (const r of recs) {
      const key = (r.date ?? "").slice(0, 7);
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + r.workedMinutes);
    }
    const vals = months.map((m) => Math.round((map.get(m.key) ?? 0) / 60)); // hours
    const max = Math.max(1, ...vals);
    return months.map((m, i) => ({ ...m, hours: vals[i], pct: Math.max(4, Math.round((vals[i] / max) * 100)) }));
  }, [months, data]);

  const totalH = bars.reduce((a, b) => a + b.hours, 0);

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="text-base font-semibold">Attendance History</h3></div>
      <p className="text-sm text-muted-foreground">Hours worked · last 6 months <span className="font-medium text-foreground">({totalH}h total)</span></p>

      <div className="mt-6 flex h-48 items-end gap-3">
        {bars.map((b, i) => (
          <div key={b.key} className="flex flex-1 flex-col items-center gap-2">
            <div className="relative flex w-full flex-1 items-end justify-center">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${b.pct}%` }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: "easeOut" }}
                className={`group w-full max-w-[52px] rounded-xl ${SHADES[i]} relative`}
                title={`${b.hours}h`}
              >
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-foreground opacity-0 transition-opacity group-hover:opacity-100">{b.hours}h</span>
              </motion.div>
            </div>
            <span className="text-xs text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
