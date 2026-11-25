"use client";
import { useMemo } from "react";
import { Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { upcoming, describe } from "@/lib/taskRepeat";

export type RepeatKind = "once" | "daily" | "weekly" | "interval";
export interface RepeatValue {
  kind: RepeatKind;
  weekdays: number[];
  everyDays: number;
  ends: { kind: "count" | "date" | "never"; count: number; date: string };
}
export const DEFAULT_REPEAT: RepeatValue = { kind: "once", weekdays: [0], everyDays: 3, ends: { kind: "count", count: 10, date: "" } };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KINDS: Array<[RepeatKind, string]> = [["once", "Once"], ["daily", "Daily"], ["weekly", "Weekly"], ["interval", "Every N days"]];

/** What the API wants from the form's value. */
export function repeatPayload(v: RepeatValue) {
  return {
    kind: v.kind,
    weekdays: v.kind === "weekly" ? v.weekdays : [],
    everyDays: v.kind === "interval" ? v.everyDays : null,
    ends: { kind: v.ends.kind, count: v.ends.kind === "count" ? v.ends.count : null, date: v.ends.kind === "date" ? v.ends.date : null },
  };
}

/**
 * How a task repeats (Tasks Part 2): one switch, and only the fields it needs. Under it, the next dates written out,
 * worked out by the same rule the server uses — so "weekly from a Tuesday" can't surprise anyone.
 */
export function RepeatFields({ value, onChange, startDate, dueTime, allowOnce = true, made = 0 }: {
  value: RepeatValue; onChange: (v: RepeatValue) => void; startDate: string; dueTime: string; allowOnce?: boolean; made?: number;
}) {
  const set = (patch: Partial<RepeatValue>) => onChange({ ...value, ...patch });
  const setEnds = (patch: Partial<RepeatValue["ends"]>) => onChange({ ...value, ends: { ...value.ends, ...patch } });

  const preview = useMemo(() => {
    if (value.kind === "once" || !startDate) return null;
    const rule = {
      kind: value.kind, weekdays: value.weekdays, everyDays: value.everyDays, startDate,
      ends: { kind: value.ends.kind, count: value.ends.count, date: value.ends.date || null },
    } as const;
    const dates = upcoming(rule as never, startDate, made, 5);
    const total = value.ends.kind === "count" ? value.ends.count : value.ends.kind === "never" ? null : upcoming(rule as never, startDate, made, 400).length + made;
    return { dates, total, text: describe(rule as never) };
  }, [value, startDate, made]);

  const time12 = (t: string) => {
    if (!t) return "";
    const h = +t.slice(0, 2);
    return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? "am" : "pm"}`;
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label id="repeat-label">Repeats</Label>
        <div role="radiogroup" aria-labelledby="repeat-label" className={cn("grid gap-1 rounded-lg bg-muted p-1", allowOnce ? "grid-cols-4" : "grid-cols-3")}>
          {KINDS.filter(([k]) => allowOnce || k !== "once").map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={value.kind === k} onClick={() => set({ kind: k })}
              className={cn("rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                value.kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {value.kind === "weekly" && (
        <div className="space-y-1.5">
          <Label>On these days</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = value.weekdays.includes(i);
              return (
                <button key={d} type="button" aria-pressed={on} aria-label={d}
                  onClick={() => {
                    const next = on ? value.weekdays.filter((x) => x !== i) : [...value.weekdays, i];
                    if (next.length) set({ weekdays: next.sort((a, b) => a - b) });
                  }}
                  className={cn("h-9 w-11 rounded-lg border text-xs font-medium transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted")}>
                  {d.slice(0, 2)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value.kind === "interval" && (
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="every-n" className="font-normal">Every</Label>
          <Input id="every-n" type="number" min={2} max={90} value={value.everyDays} className="h-9 w-20"
            onChange={(e) => set({ everyDays: Math.max(2, Math.min(90, Number(e.target.value) || 2)) })} />
          <span>days</span>
        </div>
      )}

      {value.kind !== "once" && (
        <div className="space-y-1.5">
          <Label>Ends</Label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Select value={value.ends.kind} onValueChange={(k) => setEnds({ kind: k as RepeatValue["ends"]["kind"] })}>
              <SelectTrigger className="h-9 w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="count">After</SelectItem>
                <SelectItem value="date">On</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
            {value.ends.kind === "count" && (
              <>
                <Input type="number" min={Math.max(1, made)} max={366} value={value.ends.count} className="h-9 w-20" aria-label="Number of times"
                  onChange={(e) => setEnds({ count: Math.max(1, Math.min(366, Number(e.target.value) || 1)) })} />
                <span>times</span>
              </>
            )}
            {value.ends.kind === "date" && (
              <Input type="date" value={value.ends.date} min={startDate} className="h-9 w-auto" aria-label="Last date" onChange={(e) => setEnds({ date: e.target.value })} />
            )}
          </div>
        </div>
      )}

      {preview && (
        <div className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm text-primary" aria-live="polite">
          <p className="flex items-center gap-1.5 font-medium">
            <Repeat className="h-3.5 w-3.5" />
            {preview.dates.length
              ? <>{preview.text}{preview.total == null ? ", no end" : `, ${preview.total} time${preview.total === 1 ? "" : "s"} in all`}{dueTime ? `, due by ${time12(dueTime)}` : ""}</>
              : "No dates match. Pick a day, or move the start."}
          </p>
          {preview.dates.length > 0 && (
            <p className="mt-1 text-xs tabular-nums opacity-90">
              Next: {preview.dates.map((d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })).join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
