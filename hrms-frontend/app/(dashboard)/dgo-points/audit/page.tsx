"use client";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, ScrollText, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDgoAudit, dgoErrorMessage, formatPoints } from "@/hooks/useDgoPoints";
import { DgoGate, Notice, Spinner, TableWrap, actionLabel, dateTime } from "@/components/dgo/shared";
import type { DgoAuditRow } from "@/types";

const ANY = "__any__";
const LIMIT = 50;

export default function DgoAuditPage() {
  return (
    <DgoGate allow={(me) => me.can.auditView} deniedText="Points Audit is for audit and management.">
      {() => <AuditPage />}
    </DgoGate>
  );
}

/**
 * Every change anybody made in DGO Points — read only. A row opens to show what
 * the thing looked like before and after, with the fields that changed marked.
 */
function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const actorQ = useDebouncedValue(actor, 300);
  useEffect(() => { setPage(1); }, [action, entity, actorQ, from, to]);

  const { data, isLoading, isFetching, error } = useDgoAudit({ page, limit: LIMIT, action, entity, actor: actorQ, from, to });
  const filtered = !!(action || entity || actorQ.trim() || from || to);

  return (
    <div>
      <PageHeader
        title="Points Audit"
        description="Every change made in DGO Points: who did it, when, and what it was before and after. Nothing here can be edited."
        icon={ScrollText}
      />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label>What happened</Label>
          <Select value={action || ANY} onValueChange={(v) => setAction(v === ANY ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any action</SelectItem>
              {(data?.actions ?? []).map((a) => <SelectItem key={a} value={a}>{actionLabel(a)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>On what</Label>
          <Select value={entity || ANY} onValueChange={(v) => setEntity(v === ANY ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anything</SelectItem>
              {(data?.entities ?? []).map((e) => <SelectItem key={e} value={e}>{actionLabel(e)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dgo-audit-actor">By</Label>
          <Input id="dgo-audit-actor" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="A person's name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dgo-audit-from">From</Label>
          <Input id="dgo-audit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dgo-audit-to">To</Label>
          <Input id="dgo-audit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        {filtered && (
          <div className="sm:col-span-2 lg:col-span-5">
            <Button size="sm" variant="ghost" onClick={() => { setAction(""); setEntity(""); setActor(""); setFrom(""); setTo(""); }}>
              <X className="h-4 w-4" /> Clear filters
            </Button>
          </div>
        )}
      </Card>

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "The audit log couldn't be loaded. Try again in a moment.")} />
      ) : data.rows.length === 0 ? (
        <Notice icon={ScrollText} text={filtered ? "Nothing matches these filters." : "Nothing has been recorded yet."} />
      ) : (
        <Card>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">{formatPoints(data.pagination.total)} entr{data.pagination.total === 1 ? "y" : "ies"}</span>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="w-8 px-2 py-2"><span className="sr-only">Open</span></th>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">What happened</th>
                  <th className="px-4 py-2 font-medium">On</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => {
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className={cn("cursor-pointer hover:bg-muted/40", isOpen && "bg-muted/40")}
                        onClick={() => setOpen(isOpen ? null : r.id)}
                      >
                        <td className="px-2 py-2 text-muted-foreground">
                          <ChevronDown className={cn("h-4 w-4 transition-transform", !isOpen && "-rotate-90")} aria-label={isOpen ? "Close" : "Open"} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{dateTime(r.at)}</td>
                        <td className="whitespace-nowrap px-4 py-2">{r.actorName ?? "System"}</td>
                        <td className="px-4 py-2 font-medium">{actionLabel(r.action)}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {actionLabel(r.entity)}
                          {r.entityId && <span className="ml-1 font-mono text-[11px]">{r.entityId.length > 12 ? `…${r.entityId.slice(-8)}` : r.entityId}</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5} className="bg-muted/20 px-4 py-3">
                            <BeforeAfter row={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Page {data.pagination.page} of {data.pagination.totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Newer</Button>
              <Button size="sm" variant="outline" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Older <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const pretty = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v, null, 2));

/** Before and after side by side; the fields that differ are marked on both sides. */
function BeforeAfter({ row }: { row: DgoAuditRow }) {
  const { before, after } = row;
  if (!isRecord(before) || !isRecord(after)) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <Side title="Before" empty={before == null}>
          <pre className="whitespace-pre-wrap break-all text-xs">{before == null ? "Nothing — it didn't exist yet" : pretty(before)}</pre>
        </Side>
        <Side title="After" empty={after == null}>
          <pre className="whitespace-pre-wrap break-all text-xs">{after == null ? "Nothing" : pretty(after)}</pre>
        </Side>
      </div>
    );
  }
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changed = new Set(keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])));
  const lines = (obj: Record<string, unknown>, side: "before" | "after") =>
    keys.map((k) => (
      <div
        key={k}
        className={cn(
          "rounded px-1.5 py-0.5",
          changed.has(k) && (side === "before" ? "bg-red-500/10 text-red-800 dark:text-red-300" : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"),
        )}
      >
        <span className="font-semibold">{k}</span>: <span className="whitespace-pre-wrap break-all">{k in obj ? pretty(obj[k]) : "—"}</span>
      </div>
    ));
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {changed.size === 0 ? "No field changed." : `${changed.size} field${changed.size === 1 ? "" : "s"} changed: ${Array.from(changed).join(", ")}`}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Side title="Before"><div className="space-y-0.5 font-mono text-xs">{lines(before, "before")}</div></Side>
        <Side title="After"><div className="space-y-0.5 font-mono text-xs">{lines(after, "after")}</div></Side>
      </div>
    </div>
  );
}

function Side({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-background p-3", empty && "text-muted-foreground")}>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
