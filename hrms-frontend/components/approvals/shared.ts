import type { ApprovalModule } from "@/types";

/**
 * How long something has been sitting there.
 *
 * The queue's whole argument is that age matters, so this reads in the units a
 * person would use rather than a timestamp they have to subtract in their head.
 */
export function waitingFor(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export const fmtDateTime = (iso?: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(new Date(iso))
    : "—";

/**
 * Anything waiting this long is not "in progress", it is stuck.
 *
 * The server owns this number and sends it with every response — it is the same
 * threshold the daily digest leads with. This is only the fallback for the first
 * paint, before that response has arrived.
 */
export const STALE_AFTER_DAYS = 7;

export const isStale = (iso: string | null | undefined, afterDays = STALE_AFTER_DAYS): boolean =>
  !!iso && Date.now() - new Date(iso).getTime() > afterDays * 86_400_000;

/** A colour per type, so the eye can group a mixed list without reading it. */
export const MODULE_TONE: Record<ApprovalModule, string> = {
  leave: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400",
  regularization: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
  reimbursement: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  confirmation: "bg-teal-500/10 text-teal-600 border-teal-500/20 dark:text-teal-400",
  hiring: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:text-indigo-400",
  offer: "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
  agreement: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  resignation: "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400",
};
