"use client";
import { Download, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AdSpendWeekList } from "@/types";
import { money, when } from "./format";

interface Props {
  data: AdSpendWeekList | undefined;
  loading: boolean;
  currency: string;
  canExport: boolean;
  onOpenWeek: (weekStart: string) => void;
}

type Item =
  | { kind: "logged"; weekStart: string; row: AdSpendWeekList["weeks"][number] }
  | { kind: "missing"; weekStart: string; label: string };

/** Every week in the range, logged or owed, newest first. */
export function WeeksList({ data, loading, currency, canExport, onOpenWeek }: Props) {
  if (loading || !data) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const items: Item[] = [
    ...data.weeks.map((row) => ({ kind: "logged" as const, weekStart: row.weekStart, row })),
    ...data.missing.map((m) => ({ kind: "missing" as const, weekStart: m.weekStart, label: m.label })),
  ].sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Week starting", "Week", `Total (${currency})`, "Roles", "Logged by", "Status"].map(esc).join(",")];
    for (const it of items) {
      lines.push((it.kind === "logged"
        ? [it.weekStart, it.row.label, it.row.total, it.row.roles.join("; "), it.row.loggedBy?.name ?? (it.row.source === "import" ? "Imported" : ""), it.row.nothingSpent ? "Nothing spent" : "Logged"]
        : [it.weekStart, it.label, "", "", "", "Not logged"]).map(esc).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "ad-spend-weeks.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{data.weeks.length} week{data.weeks.length === 1 ? "" : "s"} logged{data.missing.length ? ` · ${data.missing.length} not logged` : ""}</h3>
        {canExport && items.length > 0 && <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" />CSV</Button>}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No weeks in this range yet.</p>
      ) : (
        <ul>
          {items.map((it) => (
            <li key={it.weekStart} className="border-t first:border-t-0">
              <button type="button" onClick={() => onOpenWeek(it.weekStart)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40 sm:grid-cols-[12rem_minmax(0,1fr)_8rem_auto]">
                <span className="font-medium">{it.kind === "logged" ? it.row.label : it.label}</span>
                {it.kind === "logged" ? (
                  <>
                    <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
                      {it.row.nothingSpent ? "Nothing spent" : it.row.roles.join(", ")}
                      {it.row.attachments > 0 && <span className="ml-2 inline-flex items-center gap-0.5 text-xs"><Paperclip className="h-3 w-3" />{it.row.attachments}</span>}
                    </span>
                    <span className="hidden text-right font-medium tabular-nums sm:block">{money(it.row.total, currency)}</span>
                    <span className="text-right text-xs text-muted-foreground">
                      <span className="font-medium tabular-nums text-foreground sm:hidden">{money(it.row.total, currency)} · </span>
                      {it.row.source === "import" ? "Imported" : it.row.loggedBy ? `${it.row.loggedBy.name} · ${when(it.row.loggedAt)}` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="hidden sm:block" />
                    <span className="hidden sm:block" />
                    <Badge className="justify-self-end border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">Not logged</Badge>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
