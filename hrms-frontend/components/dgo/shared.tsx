"use client";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Lock, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AsyncSelect } from "@/components/ui/async-select";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDgoMe, useDgoPeople, dgoErrorMessage } from "@/hooks/useDgoPoints";
import type { DgoEventStatus, DgoLedgerType, DgoMe, DgoStage, DgoTrailEntry } from "@/types";

/*
 * Pieces every DGO Points screen shares: the gate in front of a page, the small
 * stat tile, a usage bar, status and stage labels, the person picker and the
 * month switcher. Every figure comes from the server; these only lay it out.
 */

// ─── Dates ────────────────────────────────────────────────────────────────────

export const dayLabel = (key: string | null | undefined) =>
  key ? new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export const shortDay = (key: string | null | undefined) =>
  key ? new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

/** Today in Dubai, for before /me has answered. */
export const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());

// ─── Gate ─────────────────────────────────────────────────────────────────────

/**
 * In front of every DGO page: waits for /me, then either renders the page with
 * it or says plainly why there is nothing here. The server refuses the data
 * either way; this only spares the person a page of errors.
 */
export function DgoGate({
  allow, deniedText, children,
}: {
  allow: (me: DgoMe) => boolean;
  deniedText?: string;
  children: (me: DgoMe) => React.ReactNode;
}) {
  const { data: me, isLoading, error } = useDgoMe();
  if (isLoading) return <Spinner />;
  if (error || !me) {
    return <Notice text={dgoErrorMessage(error, "DGO Points couldn't be loaded. Try again in a moment.")} />;
  }
  if (!allow(me)) {
    return (
      <Notice
        icon={Lock}
        text={deniedText ?? (me.open ? "This page isn't part of your access." : "DGO Points isn't open yet. It will appear here when HR switches it on.")}
      />
    );
  }
  return <>{children(me)}</>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-center py-16", className)}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function Notice({ text, icon: Icon }: { text: string; icon?: React.ElementType }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
      {Icon && <Icon className="h-5 w-5" />}
      <p className="max-w-md">{text}</p>
    </Card>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

export function Stat({
  label, value, sub, tone, icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "gold" | "good" | "warn" | "muted";
  icon?: React.ElementType;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p
        className={cn(
          "mt-1 text-xl font-bold tabular-nums tracking-tight md:text-2xl",
          tone === "gold" && "text-amber-600 dark:text-amber-400",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-orange-600 dark:text-orange-400",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/** A filled bar; amber past 80%, red at 100%. */
export function UsageBar({ used, of, className }: { used: number; of: number; className?: string }) {
  const pct = of > 0 ? Math.min(100, Math.round((used / of) * 100)) : used > 0 ? 100 : 0;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const STATUS: Record<DgoEventStatus, { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  posted: { label: "Posted", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", tone: "bg-red-500/10 text-red-700 dark:text-red-400" },
  capped: { label: "Held: daily cap", tone: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  budget_blocked: { label: "Held: budget used", tone: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  superseded: { label: "Replaced", tone: "bg-muted text-muted-foreground" },
  reversed: { label: "Reversed", tone: "bg-muted text-muted-foreground" },
};

export function StatusPill({ status }: { status: DgoEventStatus }) {
  const s = STATUS[status] ?? { label: status, tone: "bg-muted text-muted-foreground" };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone)}>{s.label}</span>;
}

export const LEDGER_LABEL: Record<DgoLedgerType, string> = {
  credit: "Earned",
  reverse: "Reversed",
  expire: "Expired",
  reserve: "Reserved",
  release: "Released",
  redeem: "Redeemed",
  adjust: "Adjustment",
};

export const STAGE_LABEL: Record<DgoStage, string> = {
  head: "Department head",
  hr: "HR",
  finance: "Finance",
};

/**
 * Where a request is in its chain: done steps ticked, the current one filled,
 * later ones plain. A rejected request crosses out the step that said no.
 */
export function StageChain({
  chain, stage, status, trail,
}: {
  chain: DgoStage[];
  stage: DgoStage | null;
  status: DgoEventStatus;
  trail: DgoTrailEntry[];
}) {
  if (!chain.length) {
    return <span className="text-xs text-muted-foreground">No approval needed</span>;
  }
  const currentIndex = stage ? chain.indexOf(stage) : -1;
  const rejectedAt = status === "rejected" ? trail.find((t) => t.action === "rejected")?.stage ?? null : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chain.map((s, i) => {
        const approved = trail.some((t) => t.stage === s && (t.action === "approved" || t.action === "skipped" || t.action === "submitted"));
        const rejected = rejectedAt === s;
        const current = status === "pending" && i === currentIndex;
        const done = !rejected && (approved || (status !== "pending" && status !== "rejected" && currentIndex === -1));
        return (
          <span
            key={s}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              rejected ? "bg-red-500/10 text-red-700 dark:text-red-400"
                : current ? "bg-primary text-primary-foreground"
                  : done ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground",
            )}
          >
            {rejected ? <X className="h-3 w-3" /> : done ? <Check className="h-3 w-3" /> : null}
            {STAGE_LABEL[s]}
          </span>
        );
      })}
    </div>
  );
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

/** Somebody the viewer may record points for or look up — the server decides who that is. */
export function DgoPersonSelect({
  value, onChange, placeholder = "Choose a person…", allowClear, className, disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const { data = [], isFetching } = useDgoPeople(debounced.trim());
  const options = data.map((p) => ({
    value: p.id,
    label: p.name,
    sub: [p.department, p.designation].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <AsyncSelect
      value={value}
      onChange={onChange}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search by name…"
      emptyText="Nobody found."
      allowClear={allowClear}
      className={className}
      disabled={disabled}
    />
  );
}

export function MonthSwitcher({
  month, onChange, max, busy,
}: {
  month: string;
  onChange: (month: string) => void;
  max: string;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-border">
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next month" disabled={month >= max} onClick={() => onChange(shiftMonth(month, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** A table that scrolls sideways inside itself on a phone, never the page. */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}
