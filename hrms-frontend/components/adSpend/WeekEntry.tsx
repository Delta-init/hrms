"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  useAdSpendRequisitions, useAdSpendWeek, useAttachAdSpendFile, useDeleteAdSpendWeek, useRemoveAdSpendFile, useSaveAdSpendWeek,
} from "@/hooks/useAdSpend";
import { cn } from "@/lib/utils";
import type { AdSpendSettings, AdSpendWeekDoc } from "@/types";
import { addDays, dayLabel, money, mondayOf, weekLabel, when } from "./format";

const CUSTOM = "__custom";

interface Row {
  key: string;
  requisition: string | null;
  /** Typed rather than picked — a role that has no hiring request in HRMS. */
  custom: boolean;
  role: string;
  amounts: Record<string, string>;
  note: string;
}

let seq = 0;
const blank = (): Row => ({ key: `r${++seq}`, requisition: null, custom: false, role: "", amounts: {}, note: "" });

function rowsFrom(week: AdSpendWeekDoc | null): Row[] {
  if (!week || !week.lines.length) return [blank()];
  return week.lines.map((l) => ({
    key: `r${++seq}`,
    requisition: l.requisition,
    custom: !l.requisition,
    role: l.role,
    amounts: Object.fromEntries(l.amounts.map((a) => [a.platform, String(a.amount)])),
    note: l.note ?? "",
  }));
}

const parse = (v: string | undefined) => {
  const t = (v ?? "").replace(/,/g, "").trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Props {
  settings: AdSpendSettings;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  canLog: boolean;
  canDelete: boolean;
}

/**
 * One week of ad spend: a row per role, a column per platform. Totals are
 * worked out as you type and again by the server, which is the only total
 * that is kept — nothing here is a formula somebody can break.
 */
export function WeekEntry({ settings, weekStart, onWeekChange, canLog, canDelete }: Props) {
  const { data: view, isLoading } = useAdSpendWeek(weekStart);
  const { data: requisitions = [] } = useAdSpendRequisitions(canLog);
  const save = useSaveAdSpendWeek();
  const remove = useDeleteAdSpendWeek();
  const attach = useAttachAdSpendFile();
  const detach = useRemoveAdSpendFile();

  const week = view?.week ?? null;
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [nothingSpent, setNothingSpent] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset to what is saved when the week changes or a save comes back — not
  // on every refetch, which would throw away what is being typed.
  const savedStamp = `${weekStart}:${week?.updatedAt ?? "none"}`;
  useEffect(() => {
    setRows(rowsFrom(week));
    setNothingSpent(!!week?.nothingSpent);
    setNote(week?.note ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedStamp]);

  // Retired platforms still show for a week that has money against them.
  const platforms = useMemo(() => {
    const used = new Set((week?.lines ?? []).flatMap((l) => l.amounts.map((a) => a.platform)));
    return settings.platforms.filter((p) => p.active || used.has(p.key));
  }, [settings.platforms, week]);

  const editable = canLog && !view?.future;
  const rowTotal = (r: Row) => round2(platforms.reduce((s, p) => s + (parse(r.amounts[p.key]) || 0), 0));
  const weekSum = round2(rows.reduce((s, r) => s + rowTotal(r), 0));
  const dirty = useMemo(() => {
    const now = JSON.stringify({ rows: rows.map(({ key: _k, ...r }) => r), nothingSpent, note });
    const was = JSON.stringify({ rows: rowsFrom(week).map(({ key: _k, ...r }) => r), nothingSpent: !!week?.nothingSpent, note: week?.note ?? "" });
    return now !== was;
  }, [rows, nothingSpent, note, week]);

  const update = (key: string, patch: Partial<Row>) => { setError(null); setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); };
  const setAmount = (key: string, platform: string, value: string) => {
    setError(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, amounts: { ...r.amounts, [platform]: value } } : r)));
  };

  const pickRole = (r: Row, value: string) => {
    if (value === CUSTOM) { update(r.key, { custom: true, requisition: null, role: r.custom ? r.role : "" }); return; }
    const req = requisitions.find((q) => q._id === value);
    update(r.key, { custom: false, requisition: value, role: req?.title ?? "" });
  };

  const submit = () => {
    setError(null);
    const lines = [];
    if (!nothingSpent) {
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const amounts = platforms.map((p) => ({ platform: p.key, amount: parse(r.amounts[p.key]) }));
        if (amounts.some((a) => Number.isNaN(a.amount) || a.amount < 0)) { setError(`Row ${i + 1}: amounts must be numbers`); return; }
        const spent = amounts.filter((a) => a.amount > 0);
        if (!spent.length && !r.role.trim()) continue;
        if (!r.role.trim()) { setError(`Row ${i + 1}: pick the hiring request or type the role`); return; }
        if (!spent.length) { setError(`Row ${i + 1}: enter what was spent on ${r.role}, or remove the row`); return; }
        lines.push({ requisition: r.custom ? null : r.requisition, role: r.role.trim(), amounts: spent, note: r.note.trim() });
      }
      if (!lines.length) { setError("Enter what was spent, or tick “Nothing spent this week”"); return; }
    }
    save.mutate({ weekStart, body: { nothingSpent, note: note.trim(), lines } });
  };

  const go = (n: number) => onWeekChange(addDays(weekStart, 7 * n));
  const atCurrent = weekStart >= settings.currentWeek;

  const status = !week
    ? view?.future ? <Badge variant="outline">Not started yet</Badge>
      : weekStart >= settings.currentWeek ? <Badge variant="outline">Week under way</Badge>
      : <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">Not logged yet</Badge>
    : week.nothingSpent ? <Badge variant="secondary">Nothing spent</Badge>
    : week.source === "import" ? <Badge variant="secondary">Imported from the sheet</Badge>
    : <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Logged</Badge>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => go(-1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[13rem] text-center">
            <div className="text-base font-semibold">{weekLabel(weekStart)}</div>
            <div className="text-xs text-muted-foreground">Monday to Sunday</div>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => go(1)} disabled={atCurrent} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
          {weekStart !== settings.lastWeek && (
            <Button variant="ghost" size="sm" onClick={() => onWeekChange(settings.lastWeek)}>Last week</Button>
          )}
          <Input
            type="date" aria-label="Jump to a week" className="h-9 w-[9.5rem]"
            max={settings.today} value=""
            onChange={(e) => { if (e.target.value) onWeekChange(mondayOf(e.target.value)); }}
          />
        </div>
        {status}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="min-w-[17rem] px-3 py-2 text-left font-medium">Role</th>
                  {platforms.map((p) => (
                    <th key={p.key} className="w-24 px-2 py-2 text-left font-medium">
                      {p.label}{!p.active && <span className="ml-1 text-[10px]">(retired)</span>}
                    </th>
                  ))}
                  <th className="w-28 px-3 py-2 text-right font-medium">Total</th>
                  {editable && <th className="w-10" />}
                </tr>
              </thead>
              <tbody className={cn(nothingSpent && "opacity-40")}>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t align-top">
                    <td className="px-3 py-2">
                      {editable ? (
                        <div className="space-y-1.5">
                          <Select value={r.custom ? CUSTOM : r.requisition ?? ""} onValueChange={(v) => pickRole(r, v)} disabled={nothingSpent}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Pick the hiring request" /></SelectTrigger>
                            <SelectContent>
                              {requisitions.map((q) => (
                                <SelectItem key={q._id} value={q._id}>
                                  {q.title}{q.department ? ` · ${q.department}` : ""}{q.status !== "approved" ? ` (${q.status.replace("_", " ")})` : ""}
                                </SelectItem>
                              ))}
                              {requisitions.length > 0 && <SelectSeparator />}
                              <SelectItem value={CUSTOM}>Not in HRMS — type the role</SelectItem>
                            </SelectContent>
                          </Select>
                          {r.custom && (
                            <Input className="h-9" placeholder="Forex Mentor (Malayalam)" value={r.role} disabled={nothingSpent}
                              onChange={(e) => update(r.key, { role: e.target.value })} />
                          )}
                          <Input className="h-8 text-xs" placeholder="Note (optional) — reposted, boosted…" value={r.note} disabled={nothingSpent}
                            onChange={(e) => update(r.key, { note: e.target.value })} />
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium">{r.role || "—"}</div>
                          {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                        </div>
                      )}
                    </td>
                    {platforms.map((p) => (
                      <td key={p.key} className="px-2 py-2">
                        {editable ? (
                          <Input inputMode="decimal" className="h-9 tabular-nums" placeholder="0" value={r.amounts[p.key] ?? ""} disabled={nothingSpent}
                            onChange={(e) => setAmount(r.key, p.key, e.target.value)} />
                        ) : (
                          <span className="tabular-nums">{parse(r.amounts[p.key]) ? money(parse(r.amounts[p.key]), "") : "—"}</span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium tabular-nums leading-9">{rowTotal(r) ? money(rowTotal(r), "") : "—"}</td>
                    {editable && (
                      <td className="py-2 pr-2">
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label="Remove row"
                          disabled={nothingSpent} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}>
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="px-3 py-2 text-xs font-medium text-muted-foreground" colSpan={platforms.length + 1}>Week total</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(nothingSpent ? 0 : weekSum, settings.currency)}</td>
                  {editable && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {editable ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blank()])} disabled={nothingSpent}>
                  <Plus className="h-4 w-4" />Add role
                </Button>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={nothingSpent} onCheckedChange={(v) => setNothingSpent(v === true)} />
                  Nothing spent this week
                </label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="week-note">Note for the week</Label>
                <Textarea id="week-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything HR should know — a campaign paused, an invoice still to come…" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
                {canDelete && week && (
                  <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" />Remove week
                  </Button>
                )}
                <Button onClick={submit} disabled={save.isPending || (!dirty && !!week)}>
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {week ? "Save changes" : "Save week"}
                </Button>
              </div>
            </div>
          ) : (
            week?.note && <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">{week.note}</p>
          )}

          <div className="rounded-xl border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Invoices and receipts</div>
              {canLog && week && (
                <>
                  <input ref={fileInput} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate({ weekStart, file: f }); e.target.value = ""; }} />
                  <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={attach.isPending}>
                    {attach.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}Attach
                  </Button>
                </>
              )}
            </div>
            {!week ? (
              <p className="text-xs text-muted-foreground">Save the week first, then attach its invoices.</p>
            ) : week.attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">None attached.</p>
            ) : (
              <ul className="space-y-1.5">
                {week.attachments.map((a) => (
                  <li key={a._id} className="flex items-center justify-between gap-2 text-sm">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline">
                      <FileText className="h-4 w-4 shrink-0" /><span className="truncate">{a.fileName}</span>
                    </a>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {a.uploadedBy?.name}{a.uploadedBy ? " · " : ""}{when(a.uploadedAt)}
                      {canLog && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${a.fileName}`}
                          onClick={() => detach.mutate({ weekStart, id: a._id })}><X className="h-3.5 w-3.5" /></Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {week && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {week.history.slice().reverse().slice(0, 5).map((h, i) => (
                <div key={i}>
                  {h.action === "imported" ? "Imported from the spreadsheet" : h.action === "logged" ? "Logged" : "Changed"}
                  {h.by ? ` by ${h.by.name}` : ""} · {when(h.at)} · total {money(h.total, settings.currency)}
                </div>
              ))}
            </div>
          )}
          {!canLog && !week && !view?.future && weekStart < settings.currentWeek && (
            <p className="text-sm text-muted-foreground">Nobody has logged {dayLabel(weekStart)}’s week yet.</p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove this week?"
        description={`Everything logged for ${weekLabel(weekStart)} and its attached files will be deleted. The week will show as not logged.`}
        confirmLabel="Remove week"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate(weekStart, { onSuccess: () => setConfirmDelete(false) })}
      />
    </div>
  );
}
