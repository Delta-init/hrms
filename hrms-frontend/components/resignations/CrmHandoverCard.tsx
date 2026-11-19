"use client";
import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldOff, Users, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useCrmHandover, useHandOverCrm, useMarkCrmOutside, useClearCrmOutside } from "@/hooks/useResignations";
import { cn } from "@/lib/utils";
import type { CrmHandoverStatus, CrmHandoverSystem } from "@/types";

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The leaver's CRM work, before the settlement can be finalised (2026-11-19): in each CRM, their open leads go to
 * one person or are split between several, and their login is turned off. Closed and lost leads stay theirs there,
 * so commission doesn't move. A CRM HRMS can't reach can be noted as handled outside HRMS, with why.
 */
export function CrmHandoverCard({ resignationId, settled }: { resignationId: string; settled: boolean }) {
  const { data, isLoading, isFetching, refetch } = useCrmHandover(resignationId);
  if (isLoading) {
    return <Section><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking the CRMs…</p></Section>;
  }
  if (!data?.configured) return null;
  return (
    <Section
      ready={data.ready}
      action={!settled && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />Check again
        </Button>
      )}
    >
      {!settled && (
        <p className="text-xs text-muted-foreground">
          Before finalising, {data.employee.name ? `${data.employee.name}'s` : "their"} open leads go to someone else and their CRM login is turned off.
          {data.employee.emails.length ? ` Found by ${data.employee.emails.join(" / ")}.` : ""}
        </p>
      )}
      <div className="space-y-3">
        {data.systems.map((s) => <SystemRow key={s.key} resignationId={resignationId} system={s} settled={settled} status={data} />)}
      </div>
    </Section>
  );
}

function Section({ children, ready, action }: { children: React.ReactNode; ready?: boolean; action?: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" />CRM handover
          {ready !== undefined && (
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium",
              ready ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
              {ready ? "All clear" : "Needed before finalising"}
            </span>
          )}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Badge({ s }: { s: CrmHandoverSystem }) {
  const [label, tone] =
    s.outside ? ["Handled outside HRMS", "border-sky-500/20 bg-sky-500/10 text-sky-600"]
    : !s.reachable || s.error ? ["Can't check", "border-destructive/30 bg-destructive/10 text-destructive"]
    : !s.found ? ["No account", "border-border bg-muted text-muted-foreground"]
    : s.ready ? ["Clear", "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"]
    : ["Needs handover", "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"];
  return <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", tone)}>{label}</span>;
}

function SystemRow({ resignationId, system: s, settled }: { resignationId: string; system: CrmHandoverSystem; settled: boolean; status: CrmHandoverStatus }) {
  const { hasPermission } = useAuth();
  const canAct = !settled && hasPermission("resignations", "approve");
  const open = s.open ?? 0;
  const needsHandover = s.reachable && !s.error && s.found && !s.ready;
  const cantCheck = !s.reachable || !!s.error;

  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{s.name}</span>
        <Badge s={s} />
      </div>

      {s.found && s.user && (
        <p className="text-xs text-muted-foreground">
          {s.user.name} · {s.user.email} · login {s.loginOff ? "off" : <span className="font-medium text-amber-700 dark:text-amber-400">on</span>}
          <br />
          {open > 0 ? <span className="font-medium text-foreground">{plural(open, "open lead")}</span> : "No open leads"}
          {` · ${s.closed ?? 0} closed · ${s.lost ?? 0} lost`}
          {(s.closed || s.lost) ? " (these stay with them, so commission doesn't change)" : ""}
        </p>
      )}
      {s.reachable && !s.error && !s.found && <p className="text-xs text-muted-foreground">They have no account in this CRM — nothing to hand over.</p>}
      {cantCheck && <p className="flex items-start gap-1.5 text-xs text-destructive"><WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.error}</p>}

      {needsHandover && canAct && <HandoverForm resignationId={resignationId} system={s} />}
      {cantCheck && canAct && !s.outside && <OutsideForm resignationId={resignationId} system={s} />}
      {s.outside && (
        <div className="mt-2 flex items-start justify-between gap-2 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-xs">
          <span>Handled outside HRMS — “{s.outside.reason}” · {s.outside.byName}, {when(s.outside.at)}</span>
          {canAct && <ClearOutside resignationId={resignationId} crm={s.key} />}
        </div>
      )}

      {s.log.filter((e) => e.action === "handed_over").map((e, i) => (
        <p key={i} className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>
            {e.byName}, {when(e.at)}: login turned off
            {e.moved ? ` and ${plural(e.moved, "lead")} moved — ${(e.targets ?? []).filter((t) => t.count > 0).map((t) => `${t.name} ${t.count}`).join(", ")}` : ""}
            {e.openAfter ? ` · ${plural(e.openAfter, "lead")} reached them meanwhile` : ""}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Who gets the open leads: one person, or several — split evenly or by counts. */
function HandoverForm({ resignationId, system: s }: { resignationId: string; system: CrmHandoverSystem }) {
  const open = s.open ?? 0;
  const { mutate: handOver, isPending } = useHandOverCrm();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [byCount, setByCount] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  const people = useMemo(() => s.candidates ?? [], [s.candidates]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.team ?? "").toLowerCase().includes(q)).slice(0, 60);
  }, [people, search]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "?";

  // Evenly: the first ones get one more when it doesn't divide — as the CRM splits.
  const share = picked.map((id, i) => {
    if (byCount) return Number(counts[id] || 0);
    const base = Math.floor(open / Math.max(1, picked.length));
    return base + (i < open % Math.max(1, picked.length) ? 1 : 0);
  });
  const sum = share.reduce((a, n) => a + n, 0);
  const countsBad = byCount && (sum !== open || share.some((n) => !Number.isInteger(n) || n < 0));
  const canGo = open === 0 || (picked.length > 0 && !countsBad);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const go = () =>
    handOver(
      { id: resignationId, crm: s.key, targets: open === 0 ? [] : picked.map((id, i) => ({ userId: id, count: byCount ? share[i] : null })) },
      { onSettled: () => setConfirm(false) }
    );
  const label = open === 0 ? "Turn off their login" : `Move ${plural(open, "lead")} & turn off login`;

  return (
    <div className="mt-3 space-y-2">
      {open > 0 && (
        <>
          <p className="text-xs font-medium">Give the {plural(open, "open lead")} to</p>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="h-8 pl-7 text-xs" placeholder="Search people or teams" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-44 overflow-y-auto rounded border bg-background">
            {shown.length === 0 && <p className="p-2 text-xs text-muted-foreground">Nobody matches.</p>}
            {shown.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-xs last:border-b-0 hover:bg-muted/40">
                <Checkbox checked={picked.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                <span className="flex-1 truncate">{p.name}<span className="text-muted-foreground"> · {p.team ?? "no team"}</span></span>
              </label>
            ))}
          </div>

          {picked.length > 1 && (
            <div className="flex gap-1 text-xs">
              {[false, true].map((b) => (
                <button key={String(b)} type="button" onClick={() => setByCount(b)}
                  className={cn("rounded border px-2 py-1", byCount === b ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50")}>
                  {b ? "By counts" : "Evenly"}
                </button>
              ))}
            </div>
          )}

          {picked.length > 0 && (
            <div className="space-y-1 rounded border bg-background p-2 text-xs">
              {picked.map((id, i) => (
                <div key={id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{nameOf(id)}</span>
                  {byCount
                    ? <Input type="number" min={0} step={1} className="h-7 w-20 text-right text-xs" value={counts[id] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [id]: e.target.value }))} />
                    : <span className="tabular-nums">{share[i]}</span>}
                </div>
              ))}
              {byCount && <p className={cn("pt-1 text-right", countsBad ? "text-destructive" : "text-muted-foreground")}>{sum} of {open}</p>}
            </div>
          )}
        </>
      )}

      <Button size="sm" className="w-full sm:w-auto" disabled={!canGo || isPending} onClick={() => setConfirm(true)}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}{label}
      </Button>

      <ConfirmDialog
        open={confirm} onOpenChange={setConfirm}
        title={`${label} in ${s.name}?`}
        description={
          `${s.user?.name ?? "They"} won't be able to log in to ${s.name}.` +
          (open > 0 ? ` Their open leads go to ${picked.map((id, i) => `${nameOf(id)} (${share[i]})`).join(", ")}. Closed and lost leads stay with them. The CRM can undo the move for 24 hours (Users → Recent transfers).` : "")
        }
        confirmLabel={open > 0 ? "Move & turn off" : "Turn off"} isPending={isPending} onConfirm={go}
      />
    </div>
  );
}

function OutsideForm({ resignationId, system: s }: { resignationId: string; system: CrmHandoverSystem }) {
  const { mutate: mark, isPending } = useMarkCrmOutside();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setOpen(true)}>Mark handled outside HRMS</Button>;
  }
  return (
    <div className="mt-2 space-y-2">
      <Textarea rows={2} maxLength={300} className="text-xs" placeholder={`How it was handled in ${s.name} — e.g. leads moved and login turned off there by the Sales Manager`} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={reason.trim().length < 5 || isPending} onClick={() => mark({ id: resignationId, crm: s.key, reason: reason.trim() })}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save note
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function ClearOutside({ resignationId, crm }: { resignationId: string; crm: string }) {
  const { mutate: clear, isPending } = useClearCrmOutside();
  return (
    <button type="button" className="shrink-0 text-muted-foreground underline-offset-2 hover:underline" disabled={isPending} onClick={() => clear({ id: resignationId, crm })}>
      {isPending ? "…" : "Remove"}
    </button>
  );
}
