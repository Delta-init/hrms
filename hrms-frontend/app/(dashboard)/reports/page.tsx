"use client";
import { useEffect, useMemo, useState } from "react";
import { FileBarChart, Loader2, Play, Download } from "lucide-react";
import { useReportSources, useRunReport } from "@/hooks/useReports";
import { useDepartmentsSimple } from "@/hooks/useDepartments";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadCsv } from "@/lib/csv";
import type { ReportSourceKey, ReportRow } from "@/types";

const ALL = "__all__";
const isIsoDateTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);
const displayCell = (v: string | number | null) => {
  if (v == null || v === "") return "—";
  if (isIsoDateTime(v)) return new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return v;
};

export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("reports", "view");

  const { data: sources, isLoading: sourcesLoading } = useReportSources();
  const { data: departments } = useDepartmentsSimple();
  const { mutate: run, isPending: running, data: result, reset: resetResult } = useRunReport();

  const [sourceKey, setSourceKey] = useState<ReportSourceKey | "">("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const source = sources?.find((s) => s.key === sourceKey);

  useEffect(() => {
    if (!sourceKey && sources?.length) setSourceKey(sources[0].key);
  }, [sources, sourceKey]);

  useEffect(() => {
    // Clear any previously run results on source switch — they're for a different
    // report and showing them next to the new source's columns would be misleading.
    if (source) { setSelectedColumns(source.columns.map((c) => c.key)); setFilters({}); resetResult(); }
  }, [source?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: ReportRow[] = useMemo(() => result?.rows ?? [], [result]);

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  };

  const runReport = () => {
    if (!source) return;
    run({ source: source.key, columns: selectedColumns, filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
  };

  const exportCsv = () => {
    if (!source || !rows.length) return;
    const cols = source.columns.filter((c) => selectedColumns.includes(c.key));
    const header = cols.map((c) => c.label);
    const body = rows.map((r) => cols.map((c) => displayCell(r[c.key])));
    downloadCsv(`${source.key}-report.csv`, [header, ...body]);
  };

  if (!canView) {
    return (
      <div>
        <PageHeader title="Reports" description="Build ad-hoc reports across modules and export to CSV." icon={FileBarChart} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to reports.</Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Reports" description="Build ad-hoc reports across modules and export to CSV." icon={FileBarChart} />

      {sourcesLoading || !source ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Data source</Label>
                <Select value={source.key} onValueChange={(v) => setSourceKey(v as ReportSourceKey)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sources!.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {source.filters.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{f.label}</Label>
                  {f.type === "date" ? (
                    <Input type="date" className="h-9" value={filters[f.key] ?? ""} onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))} />
                  ) : f.key === "department" ? (
                    <Select value={filters[f.key] || ALL} onValueChange={(v) => setFilters((p) => ({ ...p, [f.key]: v === ALL ? "" : v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>All departments</SelectItem>
                        {(departments ?? []).map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={filters[f.key] || ALL} onValueChange={(v) => setFilters((p) => ({ ...p, [f.key]: v === ALL ? "" : v }))}>
                      <SelectTrigger className="h-9 capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>All</SelectItem>
                        {(f.options ?? []).map((o) => <SelectItem key={o.value} value={o.value} className="capitalize">{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Columns</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {source.columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={selectedColumns.includes(c.key)} onCheckedChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={runReport} disabled={!source || running || selectedColumns.length === 0}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run Report
              </Button>
            </div>
          </Card>

          {result && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">{rows.length} row{rows.length === 1 ? "" : "s"}{rows.length >= 1000 && " (capped at 1000)"}</p>
                <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" />Export CSV</Button>
              </div>
              {rows.length === 0 ? (
                <div className="p-16 text-center text-muted-foreground">No rows match these filters.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        {source.columns.filter((c) => selectedColumns.includes(c.key)).map((c) => (
                          <th key={c.key} className="whitespace-nowrap px-4 py-3 font-medium">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                          {source.columns.filter((c) => selectedColumns.includes(c.key)).map((c) => (
                            <td key={c.key} className="whitespace-nowrap px-4 py-3">{displayCell(r[c.key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
