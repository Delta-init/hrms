"use client";
import Link from "next/link";
import { Loader2, Check, X, ExternalLink, Building2, Clock, CheckCircle2, XCircle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApprovalDetail } from "@/hooks/useApprovalInbox";
import { APPROVAL_MODULE_HREF, type ApprovalModule, type ApprovalRow } from "@/types";
import { MODULE_TONE, fmtDateTime, waitingFor } from "./shared";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row that was clicked — shown immediately while the record loads. */
  row: ApprovalRow | null;
  isPending?: boolean;
  onDecide: (approve: boolean) => void;
}

/**
 * Fields the console already shows, or that mean nothing to a reader.
 *
 * Everything else is laid out rather than hidden: the point of a view button on
 * an approvals queue is that you can decide without opening another tab, and
 * you cannot do that from a summary somebody else chose for you.
 */
const SKIP = new Set([
  "_id", "__v", "id", "organization", "createdAt", "updatedAt",
  "approvalSteps", "workflowStep", "workflowTotalSteps", "approvalTrail",
  "stageHistory", "interviews",
  // Already stated above, in the header block.
  "raisedBy", "user",
]);

const humanize = (key: string) =>
  key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

/** One value, whatever shape the seven modules happen to store it in. */
function renderValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    return value.map((v) => renderValue(v)).filter(Boolean).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // Populated references arrive as whole documents; their name is the point.
    if (typeof o.name === "string") return o.name;
    if (typeof o.title === "string") return o.title;
    return null;
  }
  const s = String(value);
  if (ISO_DATE.test(s)) return fmtDateTime(s);
  return s.replace(/_/g, " ");
}

interface TrailEntry {
  step?: number;
  roleName?: string;
  by?: { name?: string } | string;
  action?: string;
  note?: string;
  at?: string;
}

export function ApprovalDetailDialog({ open, onOpenChange, row, isPending, onDecide }: Props) {
  const { data, isLoading } = useApprovalDetail(open && row ? row.module : null, open && row ? row.id : null);

  // The row is what was clicked; the detail is what the record says now. Prefer
  // the fresher one — a queue open in two tabs goes stale within the minute.
  const current = data?.row ?? row;
  const record = data?.record ?? {};
  const decided = current?.decided ?? null;

  const fields = Object.entries(record)
    .filter(([k]) => !SKIP.has(k))
    .map(([k, v]) => [humanize(k), renderValue(v)] as const)
    .filter(([, v]) => v !== null);

  const trail = (record.approvalTrail as TrailEntry[] | undefined) ?? [];

  if (!current) return null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{current.title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-4 sm:px-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("rounded-full border px-2 py-0.5 font-medium", MODULE_TONE[current.module as ApprovalModule])}>
              {current.moduleLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
              <Building2 className="h-3 w-3" />{current.organization.name ?? "No organisation"}
            </span>
            {!decided && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />waiting {waitingFor(current.raisedAt)}
              </span>
            )}
          </div>

          {/* What was decided, if anything — stated before the detail, because
              on the history view it is the thing the reader came for. */}
          {decided && (
            <div className={cn(
              "flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm",
              decided.outcome === "approved"
                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                : "border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-400"
            )}>
              {decided.outcome === "approved" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <span className="font-medium capitalize">{decided.outcome}</span>
              {decided.by && <span className="text-muted-foreground">by {decided.by.name}</span>}
              <span className="text-muted-foreground">· {fmtDateTime(decided.at)}</span>
              {decided.note && <p className="w-full text-muted-foreground">“{decided.note}”</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:contents">
              <span className="text-muted-foreground">Raised by</span>
              <span className="font-medium sm:text-right">{current.raisedBy?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3 sm:contents">
              <span className="text-muted-foreground">Raised on</span>
              <span className="font-medium sm:text-right">{fmtDateTime(current.raisedAt)}</span>
            </div>
            {current.chain && (
              <div className="flex justify-between gap-3 sm:contents">
                <span className="text-muted-foreground">Step</span>
                <span className="font-medium sm:text-right">
                  {current.chain.step} of {current.chain.total} — {current.chain.waitingOn}
                </span>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The request</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {fields.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/50 py-1">
                    <dt className="shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Who has already signed off, on the modules that run a chain. */}
          {trail.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Already signed off</p>
              <ul className="space-y-1.5 text-sm">
                {trail.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5">
                    <span className="font-medium capitalize">{t.action ?? "—"}</span>
                    <span className="text-muted-foreground">
                      {t.roleName ? `as ${t.roleName}` : ""}
                      {typeof t.by === "object" && t.by?.name ? ` · ${t.by.name}` : ""}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(t.at)}</span>
                    {t.note && <p className="w-full text-xs text-muted-foreground">“{t.note}”</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link
            href={APPROVAL_MODULE_HREF[current.module as ApprovalModule] ?? current.href}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />Open in {current.moduleLabel}
          </Link>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!decided && (
            <>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => onDecide(false)}
                className="border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
              >
                <X className="h-4 w-4" />Reject
              </Button>
              <Button disabled={isPending} onClick={() => onDecide(true)} className="bg-emerald-600 hover:bg-emerald-700">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
