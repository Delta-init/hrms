"use client";
import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCcw, ShieldCheck } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRestorePreview, useRestoreCollection } from "@/hooks/useBackups";
import type { BackupRun } from "@/types";

/**
 * Restoring one collection, shown before it happens.
 *
 * Split in two deliberately. Picking a collection reads the archive and reports
 * what would change; nothing is written until somebody has seen those numbers.
 * A restore is the most destructive action in this application, and the
 * difference between "brings back 3 rows" and "overwrites 882" is exactly what
 * a confirmation dialog is for — but only if it says which.
 *
 * There is no "restore everything" here, on purpose. Rolling the whole database
 * back to last night discards every hour since, and no wording makes that a
 * safe button to have on a page.
 */
export function RestoreDialog({
  backup, onOpenChange,
}: { backup: BackupRun | null; onOpenChange: (open: boolean) => void }) {
  const [collection, setCollection] = useState<string>("");
  /**
   * Typed confirmation, but only where something would actually be overwritten.
   *
   * Asking for it every time teaches people to type it without reading — the
   * point is that a restore which only puts back deleted rows is a different
   * act from one that discards current data, and only the second should be made
   * hard. The word is the collection's own name, so getting it right means
   * having read which collection is about to change.
   */
  const [confirmText, setConfirmText] = useState("");
  useEffect(() => { setConfirmText(""); }, [collection]);
  const { data: preview, isFetching } = useRestorePreview(backup?._id ?? null, collection || null);
  const restore = useRestoreCollection();

  const usable = (backup?.collections ?? []).filter((c) => c.status === "included");

  return (
    <ResponsiveDialog open={!!backup} onOpenChange={(v) => { if (!v) { setCollection(""); } onOpenChange(v); }}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Restore from this backup</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {backup?.filename} · one collection at a time
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Collection</label>
            <Select value={collection} onValueChange={setCollection}>
              <SelectTrigger><SelectValue placeholder="Choose what to restore…" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {usable.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name} · {c.documents} {c.documents === 1 ? "doc" : "docs"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isFetching && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the archive…
            </p>
          )}

          {preview && !isFetching && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">In the archive</dt>
                <dd className="font-medium tabular-nums">{preview.inArchive}</dd>
                <dt className="text-muted-foreground">Live now</dt>
                <dd className="font-medium tabular-nums">{preview.liveNow}</dd>
                <dt className="text-amber-700 dark:text-amber-400">Would be overwritten</dt>
                <dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{preview.wouldReplace}</dd>
                <dt className="text-emerald-700 dark:text-emerald-400">Would come back</dt>
                <dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{preview.wouldRestore}</dd>
                <dt className="text-muted-foreground">Left alone</dt>
                <dd className="font-medium tabular-nums">{preview.untouched}</dd>
              </dl>
              {/* The reassurance that matters, because it is the thing people
                  fear about a restore and it happens to be true here. */}
              <p className="flex items-start gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                Documents are matched by id and written one by one. Nothing is deleted, and the{" "}
                {preview.untouched} row{preview.untouched === 1 ? "" : "s"} created since this backup{" "}
                {preview.untouched === 1 ? "is" : "are"} not touched.
              </p>
            </div>
          )}
          {preview && !isFetching && preview.wouldReplace > 0 && (
            <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
              <p className="flex items-start gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This overwrites {preview.wouldReplace} document{preview.wouldReplace === 1 ? "" : "s"} that exist{preview.wouldReplace === 1 ? "s" : ""} right now
              </p>
              <p className="text-xs leading-relaxed text-red-700/90 dark:text-red-400/90">
                Any change made to {preview.wouldReplace === 1 ? "it" : "them"} since{" "}
                {backup ? new Date(backup.startedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "the backup"}{" "}
                is discarded and cannot be recovered — this system keeps no record of what a document looked like
                before a restore. Take a fresh backup first if you are unsure.
              </p>
              <div className="pt-1">
                <label className="text-xs font-medium text-red-700 dark:text-red-400">
                  Type <span className="font-mono font-bold">{preview.collection}</span> to confirm
                </label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={preview.collection}
                  className="mt-1 h-8 border-red-500/40 font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          {/* Nothing to overwrite: worth saying so plainly, because a plain
              recovery should not feel as dangerous as one that discards work. */}
          {preview && !isFetching && preview.wouldReplace === 0 && preview.wouldRestore > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Nothing currently in the database would be overwritten. This only puts back{" "}
              {preview.wouldRestore} missing document{preview.wouldRestore === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restore.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            // Held until the name is typed, but only where the warning above
            // is showing — an ordinary recovery should not need a password.
            disabled={
              !preview ||
              restore.isPending ||
              (preview.wouldReplace > 0 && confirmText.trim() !== preview.collection)
            }
            onClick={() =>
              backup && restore.mutate(
                { id: backup._id, collection },
                { onSuccess: () => { setCollection(""); setConfirmText(""); onOpenChange(false); } }
              )
            }
          >
            {restore.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            {preview ? `Restore ${preview.inArchive} document${preview.inArchive === 1 ? "" : "s"}` : "Restore"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
