"use client";
import { useState } from "react";
import { DatabaseBackup, Download, RotateCcw, Loader2, CheckCircle2, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RestoreDialog } from "@/components/backups/RestoreDialog";
import { useAuth } from "@/hooks/useAuth";
import { useBackups, useCreateBackup, downloadBackup } from "@/hooks/useBackups";
import { cn } from "@/lib/utils";
import type { BackupRun } from "@/types";

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso));

/**
 * Every backup, what it captured, and what it did not.
 *
 * The per-collection breakdown is the reason this page exists rather than a
 * line in settings. "Backup succeeded" is not information — a run that wrote
 * forty documents when yesterday's wrote nine thousand also succeeded. What
 * makes an archive trustworthy is being able to see that all sixty-four
 * collections went in, and to read the reason beside any that did not.
 */
export default function BackupsPage() {
  const { user } = useAuth();
  const isSuperAdmin = !!user?.role?.isSystemRole && user.role.roleName === "Super Admin";
  const { data: runs = [], isLoading } = useBackups(isSuperAdmin);
  const create = useCreateBackup();
  const [restoring, setRestoring] = useState<BackupRun | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Backups" description="Copies of the whole database." icon={DatabaseBackup} />
        <Card className="p-6 text-sm text-muted-foreground">
          {/* Says why rather than only that it is refused — the reason is the
              useful part, and it is not about seniority. */}
          A backup is every collection in one file: password hashes, mail credentials, biometric data, passports
          and payslips together. It is restricted to Super Admins for that reason, not as a matter of rank.
        </Card>
      </div>
    );
  }

  const latest = runs.find((r) => r.status === "complete");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backups"
        description="A full copy of the database, nightly. Kept for 30 days."
        icon={DatabaseBackup}
        action={
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="gap-2">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
            {create.isPending ? "Backing up…" : "Back up now"}
          </Button>
        }
      />

      {/* The one thing worth knowing at a glance: when the last good copy was. */}
      {latest && (
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Last good backup {when(latest.startedAt)}
          </span>
          <span className="text-muted-foreground">
            {latest.totals.included}/{latest.totals.collections} collections · {latest.totals.documents.toLocaleString()} documents · {kb(latest.bytes)}
          </span>
          {latest.totals.failed > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />{latest.totals.failed} could not be read
            </span>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : runs.length === 0 ? (
        <Card className="p-10 text-center">
          <DatabaseBackup className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">No backups yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            One runs automatically each night. Press <strong>Back up now</strong> to take one immediately.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => {
            const open = expanded === r._id;
            const bad = r.collections.filter((c) => c.status !== "included");
            return (
              <Card key={r._id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      r.status === "complete" ? "bg-emerald-500/10 text-emerald-600"
                        : r.status === "failed" ? "bg-red-500/10 text-red-600" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {r.status === "complete" ? <CheckCircle2 className="h-4 w-4" />
                      : r.status === "failed" ? <AlertTriangle className="h-4 w-4" />
                      : <Loader2 className="h-4 w-4 animate-spin" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{when(r.startedAt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.status === "failed" ? (
                        <span className="text-red-600 dark:text-red-400">{r.error || "Failed"}</span>
                      ) : (
                        <>
                          {r.totals.included}/{r.totals.collections} collections · {r.totals.documents.toLocaleString()} documents · {kb(r.bytes)}
                          {r.totals.failed > 0 && <span className="text-amber-600 dark:text-amber-400"> · {r.totals.failed} unreadable</span>}
                          <span className="ml-1 text-muted-foreground/70">· {(r.durationMs / 1000).toFixed(1)}s · {r.trigger === "manual" ? "by hand" : "scheduled"}</span>
                        </>
                      )}
                    </p>
                  </div>

                  {r.status === "complete" && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm" variant="outline" className="gap-1.5"
                        disabled={downloading === r._id}
                        onClick={async () => {
                          setDownloading(r._id);
                          try { await downloadBackup(r._id, r.filename); } finally { setDownloading(null); }
                        }}
                      >
                        {downloading === r._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Download
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setRestoring(r)}>
                        <RotateCcw className="h-3.5 w-3.5" />Restore
                      </Button>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r._id)}
                        className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {open ? "Hide" : "Contents"}
                        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
                      </button>
                    </div>
                  )}
                </div>

                {open && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3">
                    {/* Anything not in the archive comes first, because it is
                        the only part that changes what somebody should do. */}
                    {bad.length > 0 && (
                      <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                          Not in this archive ({bad.length})
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {bad.map((c) => (
                            <li key={c.name} className="text-[11px] text-amber-800 dark:text-amber-300">
                              <span className="font-mono">{c.name}</span> — {c.status}: {c.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mb-1.5 text-xs font-semibold">In this archive ({r.totals.included})</p>
                    <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                      {r.collections.filter((c) => c.status === "included")
                        .sort((a, b) => b.documents - a.documents)
                        .map((c) => (
                          <div key={c.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span className={cn("truncate font-mono", c.documents === 0 && "text-muted-foreground/60")}>{c.name}</span>
                            <span className={cn("shrink-0 tabular-nums", c.documents === 0 ? "text-muted-foreground/60" : "text-muted-foreground")}>
                              {c.documents.toLocaleString()}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="mt-0.5 h-3 w-3 shrink-0" />
        This copies the database. Files stored outside it — employee documents, agreements, program images — are not
        included, so an archive restores the references to them rather than the files themselves.
      </p>

      <RestoreDialog backup={restoring} onOpenChange={(v) => !v && setRestoring(null)} />
    </div>
  );
}
