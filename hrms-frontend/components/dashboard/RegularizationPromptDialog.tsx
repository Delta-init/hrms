"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useMyMissedRegularizations } from "@/hooks/useRegularizations";
import { cn } from "@/lib/utils";
import { WEEKDAYS, MISSED_REGULARIZATION_LABELS, type MissedRegularizationDay, type MissedRegularizationKind } from "@/types";

/**
 * This month's own days worth a second look, put in front of the person once
 * a month rather than left for them to notice on the attendance page.
 *
 * Fires only when there is something to show — a clean month opens nothing —
 * and only once per month, the same "shut until it matters again" rule the
 * program prompt beside it uses, just scoped to a month instead of a day.
 */
const KEY = "hrms.regularization-prompt-dismissed";
const curMonth = () => new Date().toISOString().slice(0, 7);

const DOT: Record<MissedRegularizationKind, string> = {
  not_marked: "bg-red-500",
  half_day: "bg-orange-400",
  late: "bg-amber-500",
  early_out: "bg-rose-500",
};

function lastDismissed(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function RegularizationPromptDialog() {
  const router = useRouter();
  const { data: rows = [] } = useMyMissedRegularizations();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState<MissedRegularizationDay | null>(null);

  useEffect(() => {
    if (checked || !rows.length) return;
    setChecked(true);
    if (lastDismissed() === curMonth()) return;
    setOpen(true);
  }, [checked, rows.length]);

  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(KEY, curMonth());
    } catch {
      /* storage refused — it simply asks again next time */
    }
  };

  if (!rows.length) return null;

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const now = new Date();
  const y = now.getFullYear();
  const monthIndex = now.getMonth();
  const daysInMonth = new Date(y, monthIndex + 1, 0).getDate();
  const monthLabel = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const firstDow = new Date(y, monthIndex, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 px-4 sm:px-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <CalendarClock className="h-5 w-5 text-amber-600" />
            </div>
            <ResponsiveDialogTitle>Did you miss a regularisation?</ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className="px-4 pt-2 sm:px-0">
            {rows.length} day{rows.length === 1 ? "" : "s"} in {monthLabel} could use a correction, if something was missed.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="px-4 pb-2 sm:px-0">
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS.map((w) => <div key={w} className="text-[10px] font-semibold text-muted-foreground">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const key = `${y}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const flagged = byDate.get(key);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!flagged}
                  onClick={() => setSelected(flagged ?? null)}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center rounded-md text-xs font-medium transition",
                    flagged ? "bg-muted hover:ring-2 hover:ring-primary/40 cursor-pointer" : "text-muted-foreground/50",
                    selected?.date === key && "ring-2 ring-primary"
                  )}
                >
                  <span>{d}</span>
                  {flagged && <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", DOT[flagged.kind])} />}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
              <span className="font-medium">
                {new Date(selected.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                {" · "}{MISSED_REGULARIZATION_LABELS[selected.kind]}
              </span>
              <span className="text-muted-foreground">
                In {selected.checkIn ?? "—"} · Out {selected.checkOut ?? "—"}
              </span>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={dismiss}>Not now</Button>
          <Button
            onClick={() => {
              setOpen(false);
              router.push("/regularization");
            }}
          >
            Raise a correction
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
