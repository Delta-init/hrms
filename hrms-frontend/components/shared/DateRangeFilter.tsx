"use client";
import { useEffect, useState } from "react";
import { CalendarRange, Check, X } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useOrgTimeZone } from "@/hooks/useOrgTimeZone";
import { dayKeyIn, shiftDays, startOfWeek, startOfMonth, endOfMonth } from "@/lib/dateRange";

export type DateRangePresetKey = "today" | "yesterday" | "week" | "month";

const PRESETS: { key: DateRangePresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

/** The two dates a preset covers, as YYYY-MM-DD in `tz`. */
export function presetRange(key: DateRangePresetKey, tz: string): { from: string; to: string } {
  const today = dayKeyIn(new Date(), tz);
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": { const d = shiftDays(today, -1); return { from: d, to: d }; }
    // Weeks start on Sunday, matching the attendance calendar grid.
    case "week": return { from: startOfWeek(today), to: today };
    case "month": return { from: startOfMonth(today), to: endOfMonth(today) };
  }
}

interface Props {
  from?: string;
  to?: string;
  /** Both dates change together — a half-applied range would refetch twice. */
  onChange: (range: { from: string; to: string }) => void;
  onClear: () => void;
  /** What the range applies to, when it isn't just "the date" — resignations
   *  filter on the last working day, for instance. */
  label?: string;
  className?: string;
}

const fmt = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * Quick date-range picker for a table toolbar. Presets are resolved in the
 * organization's timezone rather than the viewer's, so "today" means the same
 * day the records were filed under — the server reads these bounds as local
 * days in that same zone.
 */
export function DateRangeFilter({ from, to, onChange, onClear, label: fieldLabel = "Date range", className }: Props) {
  const tz = useOrgTimeZone();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from ?? "");
  const [draftTo, setDraftTo] = useState(to ?? "");

  // Reopen on whatever is actually applied, not on a stale half-typed range.
  useEffect(() => {
    if (open) { setDraftFrom(from ?? ""); setDraftTo(to ?? ""); setCustom(false); }
  }, [open, from, to]);

  const active = PRESETS.find((p) => {
    if (!from || !to) return false;
    const r = presetRange(p.key, tz);
    return r.from === from && r.to === to;
  });

  const label = active ? active.label
    : from && to ? (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`)
    : from ? `From ${fmt(from)}`
    : to ? `Until ${fmt(to)}`
    : fieldLabel;

  const apply = (range: { from: string; to: string }) => { onChange(range); setOpen(false); };
  const hasRange = !!(from || to);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline" size="sm"
          className={cn("h-9 gap-2", hasRange && "border-primary/40 bg-primary/5 text-primary", className)}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          <span className="max-w-[150px] truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="px-2 py-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{fieldLabel}</p>
        </div>
        <DropdownMenuSeparator />

        {PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.key}
            className="cursor-pointer justify-between"
            onSelect={() => apply(presetRange(p.key, tz))}
          >
            {p.label}
            {active?.key === p.key && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {!custom ? (
          <DropdownMenuItem
            className="cursor-pointer justify-between"
            onSelect={(e) => { e.preventDefault(); setCustom(true); }}
          >
            Custom range
            {hasRange && !active && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ) : (
          <div className="space-y-2 px-2 py-2">
            <div className="space-y-1">
              <Label htmlFor="rangeFrom" className="text-[11px] text-muted-foreground">From</Label>
              <Input id="rangeFrom" type="date" value={draftFrom} max={draftTo || undefined}
                onChange={(e) => setDraftFrom(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rangeTo" className="text-[11px] text-muted-foreground">To</Label>
              <Input id="rangeTo" type="date" value={draftTo} min={draftFrom || undefined}
                onChange={(e) => setDraftTo(e.target.value)} className="h-8" />
            </div>
            <Button
              size="sm" className="h-8 w-full"
              disabled={!draftFrom && !draftTo}
              onClick={() => apply({ from: draftFrom, to: draftTo })}
            >
              Apply
            </Button>
          </div>
        )}

        {hasRange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-muted-foreground"
              onSelect={() => { onClear(); setOpen(false); }}
            >
              <X className="mr-2 h-3.5 w-3.5" />Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
