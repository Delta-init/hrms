"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Upload, FileSpreadsheet, AlertTriangle, XCircle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useImportSalarySheet } from "@/hooks/usePayslips";
import { cn } from "@/lib/utils";
import type { SalarySheetImportResult, SalarySheetImportRow, SheetFigures } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
}

const fmt = (n: number) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** The figures shown per row, in sheet order. */
const COLS: Array<{ key: keyof SheetFigures; label: string }> = [
  { key: "lopDays", label: "LOP days" },
  { key: "gross", label: "Gross" },
  { key: "loan", label: "Loan" },
  { key: "advance", label: "Advance" },
  { key: "lop", label: "LOP ded." },
  { key: "other", label: "Other" },
  { key: "net", label: "Net pay" },
];

const actionStyle: Record<SalarySheetImportRow["action"], string> = {
  create: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
  replace: "border-sky-500/20 bg-sky-500/10 text-sky-600",
  skip: "border-red-500/20 bg-red-500/10 text-red-600",
};
const actionLabel: Record<SalarySheetImportRow["action"], string> = { create: "New", replace: "Replace", skip: "Not imported" };

export function ImportSalarySheetDialog({ open, onOpenChange, month }: Props) {
  const { mutate, isPending } = useImportSalarySheet();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SalarySheetImportResult | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [showLists, setShowLists] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null); setResult(null); setAttentionOnly(false); setShowLists(false);
  }, [open, month]);

  const check = (f: File) => {
    setFile(f);
    setResult(null);
    mutate({ month, file: f, apply: false }, { onSuccess: setResult });
  };
  const apply = () => {
    if (!file) return;
    mutate({ month, file, apply: true }, { onSuccess: setResult });
  };

  const rows = useMemo(() => {
    const all = [...(result?.rows ?? [])].sort(
      (a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || Number(b.warnings.length > 0) - Number(a.warnings.length > 0) || a.line - b.line
    );
    return attentionOnly ? all.filter((r) => r.errors.length || r.warnings.length) : all;
  }, [result, attentionOnly]);

  const importable = result ? result.counts.create + result.counts.replace : 0;
  const done = result?.applied;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-5xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Import salary sheet — {monthLabel(month)}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f); e.target.value = ""; }}
          />

          {!result && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={isPending}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /> : <FileSpreadsheet className="h-7 w-7 text-muted-foreground" />}
              <span className="text-sm font-medium">{isPending ? `Checking ${file?.name ?? "the sheet"}…` : "Choose the salary sheet (.xlsx)"}</span>
              <span className="max-w-md text-xs text-muted-foreground">
                The same layout as &ldquo;Download salary sheet&rdquo;. Rows are matched by Employee No. Nothing is changed until you
                review the check and press Import.
              </span>
            </button>
          )}

          {result && !done && (
            <>
              {result.locked && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{result.locked}. It can&rsquo;t be imported into.</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-muted-foreground">{result.fileName}</span>
                <span className={cn("rounded-full border px-2 py-0.5", actionStyle.create)}>{result.counts.create} new</span>
                <span className={cn("rounded-full border px-2 py-0.5", actionStyle.replace)}>{result.counts.replace} replace existing</span>
                {result.counts.errors > 0 && <span className={cn("rounded-full border px-2 py-0.5", actionStyle.skip)}>{result.counts.errors} not imported</span>}
                {result.counts.warnings > 0 && (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-600">{result.counts.warnings} to look at</span>
                )}
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                  <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
                  Only rows with a note
                </label>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[820px] text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Employee</th>
                      <th className="px-3 py-2 font-medium"></th>
                      {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => <Row key={`${r.line}-${r.code}`} r={r} />)}
                    {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Nothing to look at.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Where the system&rsquo;s figure differs from the sheet it is shown struck through underneath. The sheet&rsquo;s figure is what gets imported.
              </p>

              {(result.skipped.length > 0 || result.missing.length > 0) && (
                <div className="rounded-lg border border-border p-3 text-xs">
                  <button type="button" onClick={() => setShowLists((v) => !v)} className="inline-flex items-center gap-1 font-medium">
                    {result.skipped.length > 0 && `${result.skipped.length} row(s) without an Employee No`}
                    {result.skipped.length > 0 && result.missing.length > 0 && " · "}
                    {result.missing.length > 0 && `${result.missing.length} on payroll but not in the sheet (left as they are)`}
                    {showLists ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {showLists && (
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {result.skipped.length > 0 && (
                        <ul className="space-y-0.5 text-muted-foreground">
                          {result.skipped.map((s) => <li key={s.line}>Row {s.line}: {s.name}</li>)}
                        </ul>
                      )}
                      {result.missing.length > 0 && (
                        <ul className="space-y-0.5 text-muted-foreground">
                          {result.missing.map((m) => <li key={`${m.code}-${m.name}`}>{m.code} {m.name}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {done && (
            <div className="space-y-3 py-2">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
                {done.created} new and {done.replaced} replaced payslip{done.created + done.replaced === 1 ? "" : "s"} saved as drafts.
              </p>
              {done.failed.length > 0 && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">
                  <p className="mb-1 font-medium">{done.failed.length} could not be imported:</p>
                  <ul className="space-y-0.5">{done.failed.map((f) => <li key={f.code}>{f.code} {f.name} — {f.error}</li>)}</ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Imported payslips keep the sheet&rsquo;s figures. To change one, correct the sheet and import again, or move it back to not generated to have it calculated.
              </p>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter>
          {done ? (
            <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              {result && (
                <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={isPending}>
                  <Upload className="h-4 w-4" />Another file
                </Button>
              )}
              {result && (
                <Button type="button" onClick={apply} disabled={isPending || !!result.locked || importable === 0}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import {importable} payslip{importable === 1 ? "" : "s"}
                </Button>
              )}
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Row({ r }: { r: SalarySheetImportRow }) {
  const sys = r.system;
  return (
    <>
      <tr className={cn("border-t border-border/60", r.errors.length > 0 && "bg-red-500/5")}>
        <td className="px-3 py-2">
          <p className="font-medium">{r.employee?.name ?? r.name}</p>
          <p className="text-[11px] text-muted-foreground">{r.code} · row {r.line}</p>
        </td>
        <td className="px-3 py-2">
          <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", actionStyle[r.action])}>{actionLabel[r.action]}</span>
        </td>
        {COLS.map((c) => {
          const mine = r.sheet[c.key];
          const theirs = sys?.[c.key];
          const differs = theirs !== undefined && Math.abs(mine - theirs) > 0.01;
          return (
            <td key={c.key} className={cn("px-3 py-2 text-right tabular-nums", c.key === "net" && "font-semibold", differs && "bg-amber-500/10")}>
              {fmt(mine)}
              {differs && <p className="text-[10px] text-muted-foreground line-through">{fmt(theirs!)}</p>}
            </td>
          );
        })}
      </tr>
      {(r.errors.length > 0 || r.warnings.length > 0) && (
        <tr className={cn(r.errors.length > 0 && "bg-red-500/5")}>
          <td colSpan={9} className="px-3 pb-2 pt-0">
            {r.errors.map((m) => <p key={m} className="flex items-start gap-1 text-[11px] text-red-600"><XCircle className="mt-px h-3 w-3 shrink-0" />{m}</p>)}
            {r.warnings.map((m) => <p key={m} className="flex items-start gap-1 text-[11px] text-amber-600"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{m}</p>)}
          </td>
        </tr>
      )}
    </>
  );
}
