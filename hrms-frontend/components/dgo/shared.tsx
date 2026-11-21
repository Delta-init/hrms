"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, FileText, Loader2, Lock, Medal, Paperclip, Trophy, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { AsyncSelect } from "@/components/ui/async-select";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDgoMe, useDgoPeople, useDgoColleagues, useDgoUpload, dgoErrorMessage, formatPoints } from "@/hooks/useDgoPoints";
import type {
  DgoEventStatus, DgoLedgerRow, DgoLedgerType, DgoMe, DgoPointTotals, DgoPurchaseStatus, DgoRedemptionStatus, DgoStage,
  DgoTrailEntry, DgoUpload, DgoUploadKind,
} from "@/types";

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
  reserve: "Held for a reward",
  release: "Returned",
  redeem: "Spent on a reward",
  adjust: "Adjustment",
};

const LEDGER_TONE: Record<DgoLedgerType, string> = {
  credit: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  reverse: "bg-red-500/10 text-red-700 dark:text-red-400",
  expire: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  reserve: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  release: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  redeem: "bg-muted text-muted-foreground",
  adjust: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

/**
 * What kind of ledger line it is, as a small coloured label. An expiry for
 * somebody who left says so ("Left the company") rather than just "Expired".
 */
export function LedgerTypeChip({ row }: { row: Pick<DgoLedgerRow, "type" | "description"> }) {
  const leaver = row.type === "expire" && /left the company/i.test(row.description ?? "");
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", LEDGER_TONE[row.type] ?? "bg-muted text-muted-foreground")}>
      {leaver ? "Left the company" : LEDGER_LABEL[row.type] ?? row.type}
    </span>
  );
}

/**
 * A ledger line's points. `delta` is what it did to spendable points; a reward
 * being handed over spends points that were already held, so its delta is 0 and
 * the figure that matters is what left the held pile.
 */
export function LedgerPoints({ row, className }: { row: Pick<DgoLedgerRow, "type" | "delta" | "reservedDelta">; className?: string }) {
  if (row.type === "redeem") {
    const spent = Math.abs(row.reservedDelta ?? 0);
    return (
      <span className={cn("font-semibold tabular-nums text-muted-foreground", className)} title="Taken from the points already held for this reward">
        −{formatPoints(spent)}
      </span>
    );
  }
  const tone =
    row.type === "expire" ? "text-amber-700 dark:text-amber-400"
      : row.type === "adjust" ? "text-violet-700 dark:text-violet-400"
        : row.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <span className={cn("font-semibold tabular-nums", tone, className)}>
      {row.delta >= 0 ? "+" : "−"}{formatPoints(Math.abs(row.delta))}
    </span>
  );
}

const PURCHASE: Record<DgoPurchaseStatus, { label: string; tone: string }> = {
  not_needed: { label: "No purchase needed", tone: "bg-muted text-muted-foreground" },
  waiting_finance: { label: "Waiting for finance", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  approved: { label: "Purchase approved", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Purchase rejected", tone: "bg-red-500/10 text-red-700 dark:text-red-400" },
  cancelled: { label: "Purchase cancelled", tone: "bg-muted text-muted-foreground" },
};

/** Where the purchase behind a redemption stands with finance; "Approved — EXP-00012" once it has a number. */
export function PurchasePill({ purchase }: { purchase: { status: DgoPurchaseStatus; ref: string | null } }) {
  const s = PURCHASE[purchase.status] ?? { label: purchase.status, tone: "bg-muted text-muted-foreground" };
  const label = purchase.status === "approved" && purchase.ref ? `Approved — ${purchase.ref}` : s.label;
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone)}>{label}</span>;
}

/**
 * A month's points as a statement: opening, what came in and went out, closing.
 * The badge says whether it adds up; the server checks, this only lays it out.
 */
export function PointsStatement({
  totals, pointValueAed, holds, title = "Points this month",
}: {
  totals: DgoPointTotals;
  pointValueAed: number;
  holds?: boolean;
  title?: string;
}) {
  const lines: Array<{ label: string; value: number; sign: "" | "+" | "−"; hint?: string }> = [
    { label: "Opening — points outstanding", value: totals.opening, sign: "" },
    { label: "Issued", value: totals.issued, sign: "+", hint: "credited for earnings and prizes" },
    { label: "Spent on rewards", value: totals.spent, sign: "−", hint: "handed over" },
    { label: "Taken back", value: totals.reversed, sign: "−", hint: "reversals" },
    { label: "Expired", value: totals.expired, sign: "−", hint: "12 months old, or the person left" },
    { label: "Adjustments", value: Math.abs(totals.adjusted), sign: totals.adjusted < 0 ? "−" : "+", hint: "approved by two people" },
  ];
  const aed = (p: number) => Math.round(p * pointValueAed * 100) / 100;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {holds !== undefined && (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            holds ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400",
          )}>
            {holds ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {holds ? "Adds up" : "Doesn't add up"}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border text-sm">
        {lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2 last:border-0">
            <span>
              {l.label}
              {l.hint && <span className="hidden text-xs text-muted-foreground sm:inline"> · {l.hint}</span>}
            </span>
            <span className="whitespace-nowrap font-medium tabular-nums">
              {l.sign && <span className="mr-1 text-muted-foreground">{l.sign}</span>}
              {formatPoints(l.value)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 bg-muted/60 px-3 py-2 font-semibold">
          <span>Closing — points outstanding</span>
          <span className="whitespace-nowrap tabular-nums">
            {formatPoints(totals.closing)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">≈ AED {aed(totals.closing).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Outstanding means points people still hold: spendable plus held for rewards.</p>
    </div>
  );
}

const REDEMPTION: Record<DgoRedemptionStatus, { label: string; tone: string }> = {
  reserved: { label: "Waiting for HR", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved — on its way", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  fulfilled: { label: "Delivered", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
  rejected: { label: "Rejected", tone: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

export function RedemptionPill({ status }: { status: DgoRedemptionStatus }) {
  const s = REDEMPTION[status] ?? { label: status, tone: "bg-muted text-muted-foreground" };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone)}>{s.label}</span>;
}

/** "submitted", "send_back" → "Submitted", "Send back" */
export const actionLabel = (action: string) => {
  const s = action.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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

/** Anyone active in the organisation except you — for nominating. */
export function DgoColleagueSelect({
  value, onChange, placeholder = "Choose a colleague…", className, disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const { data = [], isFetching } = useDgoColleagues(debounced.trim());
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
      className={className}
      disabled={disabled}
    />
  );
}

/**
 * Attach one photo or PDF (10 MB at most). Uploads as soon as it is picked and
 * hands back the stored key; the form keeps the key, not the file.
 */
export function DgoFileUpload({
  kind, value, onChange, label = "Attach a photo or PDF", disabled,
}: {
  kind: DgoUploadKind;
  value: DgoUpload | null;
  onChange: (upload: DgoUpload | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useDgoUpload();
  const isImage = value?.contentType?.startsWith("image/");
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          upload.mutate({ file, kind }, { onSuccess: (u) => onChange(u) });
        }}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border p-2">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></span>
          )}
          <a href={value.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-primary hover:underline">{value.fileName}</a>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove the file" disabled={disabled} onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={disabled || upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          {upload.isPending ? "Uploading…" : label}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or PDF, up to 10 MB.</p>
    </div>
  );
}

/** The two halves of the leaderboard: everyday points, and the monthly achievers. */
export function LeaderboardTabs({ active }: { active: "points" | "achievers" }) {
  const tabs = [
    { key: "points", label: "Points", href: "/dgo-points/leaderboard", icon: Trophy },
    { key: "achievers", label: "Monthly achievers", href: "/dgo-points/achievers", icon: Medal },
  ] as const;
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <t.icon className="h-4 w-4" />
          {t.label}
        </Link>
      ))}
    </div>
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

/**
 * Confirm one step — approve, reject, send back, publish — with a note that is
 * optional or, where the step needs a reason, required.
 */
export function NoteDialog({
  open, onOpenChange, title, description, noteLabel = "Note (optional)", placeholder,
  requireNote, confirmLabel, tone = "primary", icon: Icon, isPending, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  noteLabel?: string;
  placeholder?: string;
  requireNote?: boolean;
  confirmLabel: string;
  tone?: "primary" | "good" | "danger";
  icon?: React.ElementType;
  isPending?: boolean;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => { if (open) setNote(""); }, [open]);
  const blocked = !!requireNote && !note.trim();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          {description && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{description}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        <div className="space-y-2 px-4 sm:px-0">
          <Label htmlFor="dgo-step-note">{requireNote ? noteLabel.replace(/\s*\(optional\)/i, "") + " (required)" : noteLabel}</Label>
          <Textarea id="dgo-step-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={placeholder} />
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button
            className={cn(tone === "good" && "bg-emerald-600 hover:bg-emerald-700", tone === "danger" && "bg-red-600 hover:bg-red-700")}
            disabled={blocked || isPending}
            onClick={() => onConfirm(note.trim())}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
            {confirmLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
