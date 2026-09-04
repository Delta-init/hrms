"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { LEAVE_TYPE_LABELS, type LeaveRequest, type Holiday, WEEKDAYS, leaveTypeLabel } from "@/types";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayKey(iso: string) {
  return iso.slice(0, 10);
}

interface Props {
  leaves: LeaveRequest[];
  holidays: Holiday[];
}

export function LeaveCalendar({ leaves, holidays }: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startDay = first.getDay(); // 0=Sun
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.y, cursor.m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  // Map each day → entries. A leave spans its date range.
  const entriesFor = (date: Date) => {
    const key = ymd(date);
    const items: { label: string; kind: "approved" | "pending" | "rejected" | "holiday"; detail?: string }[] = [];
    for (const h of holidays) {
      if (dayKey(h.date) === key) items.push({ label: h.name, kind: "holiday" });
    }
    for (const l of leaves) {
      const s = dayKey(l.startDate);
      const e = dayKey(l.endDate);
      if (key >= s && key <= e && l.status !== "cancelled") {
        const who = l.user && typeof l.user === "object" ? l.user.name.split(" ")[0] : "";
        // A day in the middle of a longer request reads the same in the cell
        // as a single day off would — the range only earns its place in the
        // detail view, where there is room to say it.
        const spansMultiple = s !== e;
        const range = spansMultiple
          ? `${new Date(l.startDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${new Date(l.endDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
          : null;
        items.push({
          label: `${who} · ${leaveTypeLabel(l.type)}`,
          kind: l.status === "approved" ? "approved" : l.status === "rejected" ? "rejected" : "pending",
          detail: [range, l.halfDay ? "half day" : null, l.reason].filter(Boolean).join(" · ") || undefined,
        });
      }
    }
    return items;
  };

  const kindStyle: Record<string, string> = {
    approved: "bg-emerald-500/15 text-emerald-700",
    pending: "bg-amber-500/15 text-amber-700",
    rejected: "bg-red-500/10 text-red-600 line-through",
    holiday: "bg-primary/15 text-primary",
  };

  const isToday = (d: Date) => ymd(d) === ymd(now);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{MONTHS[cursor.m]} {cursor.y}</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => ({ ...(c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }) }))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => ({ ...(c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }) }))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-muted/50 py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
        {grid.map((date, i) => {
          const entries = date ? entriesFor(date) : [];
          return (
            <button
              key={i}
              type="button"
              disabled={!date || !entries.length}
              onClick={() => date && setSelectedDay(date)}
              className={cn(
                "min-h-[92px] bg-background p-1.5 text-left transition",
                !date && "bg-muted/20",
                date && entries.length > 0 && "cursor-pointer hover:bg-muted/40"
              )}
            >
              {date && (
                <>
                  <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs", isToday(date) ? "bg-primary font-bold text-primary-foreground" : "text-muted-foreground")}>
                    {date.getDate()}
                  </div>
                  <div className="space-y-1">
                    {entries.slice(0, 3).map((it, j) => (
                      <motion.div key={j} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("truncate rounded px-1.5 py-0.5 text-[10px] font-medium", kindStyle[it.kind])} title={it.label}>
                        {it.label}
                      </motion.div>
                    ))}
                    {entries.length > 3 && (
                      <div className="px-1.5 text-[10px] text-muted-foreground">+{entries.length - 3} more</div>
                    )}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>

      <ResponsiveDialog open={!!selectedDay} onOpenChange={(v) => !v && setSelectedDay(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {selectedDay?.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="max-h-[min(24rem,55vh)] space-y-2 overflow-y-auto px-4 pb-4 sm:px-0">
            {(selectedDay ? entriesFor(selectedDay) : []).map((it, j) => (
              <div key={j} className={cn("rounded-lg px-3 py-2 text-sm", kindStyle[it.kind])}>
                <p className="font-medium">{it.label}</p>
                {it.detail && <p className="mt-0.5 text-xs opacity-80">{it.detail}</p>}
              </div>
            ))}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {[["approved", "Approved"], ["pending", "Pending"], ["holiday", "Holiday"]].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded", kindStyle[k].split(" ")[0])} />{l}</span>
        ))}
      </div>
    </div>
  );
}
