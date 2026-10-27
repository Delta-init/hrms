"use client";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Clock, Loader2, Minus, Plus, Search, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { EmployeeSelect, DepartmentSelect } from "@/components/pickers";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  useProcurementLedger, useProcurementLedgerItem, useGiveOut, useRemoveGiveOut,
  type LedgerRow, type LedgerEntry,
} from "@/hooks/useProcurements";
import { cn } from "@/lib/utils";

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const today = () => new Date().toISOString().slice(0, 10);

/** Available is the number that matters — coloured by how much is left. */
function AvailablePill({ row }: { row: LedgerRow }) {
  const tone = row.available === 0
    ? "border-red-500/20 bg-red-500/10 text-red-600"
    : row.received > 0 && row.available / row.received <= 0.2
      ? "border-amber-500/20 bg-amber-500/10 text-amber-600"
      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600";
  return <span className={cn("inline-flex min-w-[2.5rem] justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums", tone)}>{row.available}</span>;
}

/**
 * The Ledger tab: what procurement brought in, what has been handed out, and
 * what is left on the shelf — one row per item, every purchase of it added up.
 * A row opens its movements, oldest first, with the balance after each.
 */
export function ProcurementLedger({ canGiveOut }: { canGiveOut: boolean }) {
  const { data: rows = [], isLoading } = useProcurementLedger();
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [giveOutRow, setGiveOutRow] = useState<LedgerRow | null>(null);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!inStockOnly || r.available > 0) && (!needle || r.key.includes(needle) || r.category.toLowerCase().includes(needle)));
  const totals = rows.reduce((t, r) => ({ received: t.received + r.received, givenOut: t.givenOut + r.givenOut, available: t.available + r.available, onOrder: t.onOrder + r.onOrder }), { received: 0, givenOut: 0, available: 0, onOrder: 0 });

  const giveOutButton = (r: LedgerRow) => canGiveOut && (
    <Button size="sm" variant="outline" disabled={r.available === 0} onClick={(e) => { e.stopPropagation(); setGiveOutRow(r); }}>
      <ArrowUpRight className="h-3.5 w-3.5" />Give out
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Received", value: totals.received, tone: "text-foreground" },
          { label: "Given out", value: totals.givenOut, tone: "text-sky-600" },
          { label: "Available", value: totals.available, tone: "text-emerald-600" },
          { label: "On order", value: totals.onOrder, tone: "text-amber-600" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", s.tone)}>{isLoading ? "…" : s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items or category…" className="pl-9" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={inStockOnly} onCheckedChange={setInStockOnly} />
          Only items still in stock
        </label>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : shown.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground">
          <BookOpen className="mx-auto mb-2 h-7 w-7" />
          {rows.length ? "Nothing matches." : "Nothing received through procurement yet."}
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 text-right font-medium">Received</th>
                  <th className="px-4 py-3 text-right font-medium">Given out</th>
                  <th className="px-4 py-3 text-center font-medium">Available</th>
                  <th className="px-4 py-3 text-right font-medium">On order</th>
                  <th className="px-4 py-3 font-medium">Last given out</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} onClick={() => setOpenKey(r.key)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.item}</p>
                      {r.category && <p className="text-xs text-muted-foreground">{r.category}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.received}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-sky-600">{r.givenOut || "—"}</td>
                    <td className="px-4 py-3 text-center"><AvailablePill row={r} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-600">{r.onOrder || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.lastOut)}</td>
                    <td className="px-4 py-3 text-right">{giveOutButton(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="space-y-2 md:hidden">
            {shown.map((r) => (
              <Card key={r.key} className="p-3" onClick={() => setOpenKey(r.key)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.item}</p>
                    {r.category && <p className="text-xs text-muted-foreground">{r.category}</p>}
                  </div>
                  <AvailablePill row={r} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                  Received {r.received} · given out {r.givenOut}{r.onOrder ? ` · ${r.onOrder} on order` : ""}
                </p>
                {canGiveOut && <div className="mt-2">{giveOutButton(r)}</div>}
              </Card>
            ))}
          </div>
        </>
      )}

      <MovementsDialog itemKey={openKey} onClose={() => setOpenKey(null)} canGiveOut={canGiveOut} onGiveOut={setGiveOutRow} />
      <GiveOutDialog row={giveOutRow} onClose={() => setGiveOutRow(null)} />
    </div>
  );
}

const KIND: Record<LedgerEntry["kind"], { label: string; icon: React.ElementType; tone: string }> = {
  received: { label: "Received", icon: ArrowDownLeft, tone: "text-emerald-600 bg-emerald-500/10" },
  given_out: { label: "Given out", icon: ArrowUpRight, tone: "text-sky-600 bg-sky-500/10" },
  on_order: { label: "On order", icon: Clock, tone: "text-amber-600 bg-amber-500/10" },
};

/** One item's movements, oldest first, with what was left after each. */
function MovementsDialog({ itemKey, onClose, canGiveOut, onGiveOut }: {
  itemKey: string | null; onClose: () => void; canGiveOut: boolean; onGiveOut: (r: LedgerRow) => void;
}) {
  const { data, isLoading } = useProcurementLedgerItem(itemKey);
  const { mutate: remove, isPending: removing } = useRemoveGiveOut();
  const [removeTarget, setRemoveTarget] = useState<LedgerEntry | null>(null);
  const totals = data?.totals;

  return (
    <ResponsiveDialog open={!!itemKey} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{data?.item ?? "Ledger"}</ResponsiveDialogTitle>
          {totals && (
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              Received {totals.received} · given out {totals.givenOut} · <span className="font-semibold text-emerald-600">{totals.available} available</span>
              {totals.onOrder ? ` · ${totals.onOrder} on order` : ""}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-4 sm:px-0">
          {isLoading || !data ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Entry</th>
                  <th className="py-2 pr-2 text-right font-medium">In</th>
                  <th className="py-2 pr-2 text-right font-medium">Out</th>
                  <th className="py-2 pr-2 text-right font-medium">Balance</th>
                  {canGiveOut && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => {
                  const k = KIND[e.kind];
                  const detail = e.kind === "given_out"
                    ? [e.who, e.department].filter(Boolean).join(" · ")
                    : [e.vendor, e.department].filter(Boolean).join(" · ");
                  return (
                    <tr key={`${e.kind}-${e.id}`} className={cn("border-b border-border/60 last:border-0 align-top", e.kind === "on_order" && "text-muted-foreground")}>
                      <td className="whitespace-nowrap py-2.5 pr-2 text-muted-foreground">{fmtDate(e.date)}</td>
                      <td className="py-2.5 pr-2">
                        <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", k.tone)}>
                          <k.icon className="h-3 w-3" />{k.label}
                        </span>
                        {detail && <p className="mt-0.5 text-xs">{detail}</p>}
                        {e.note && <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p>}
                        {e.by && <p className="mt-0.5 text-[11px] text-muted-foreground">by {e.by}</p>}
                      </td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-emerald-600">{e.kind === "received" ? `+${e.quantity}` : e.kind === "on_order" ? `(${e.quantity})` : ""}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-sky-600">{e.kind === "given_out" ? `−${e.quantity}` : ""}</td>
                      <td className="py-2.5 pr-2 text-right font-semibold tabular-nums">{e.balance ?? "—"}</td>
                      {canGiveOut && (
                        <td className="py-2 text-right">
                          {e.kind === "given_out" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Remove this entry" aria-label="Remove this entry" onClick={() => setRemoveTarget(e)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canGiveOut && totals && (
            <Button disabled={totals.available === 0} onClick={() => onGiveOut(totals)}><ArrowUpRight className="h-4 w-4" />Give out</Button>
          )}
        </ResponsiveDialogFooter>

        <ConfirmDialog
          open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}
          title="Remove this entry"
          description={removeTarget ? `${removeTarget.quantity} given out on ${fmtDate(removeTarget.date)} goes back into stock.` : ""}
          confirmLabel="Remove" isPending={removing}
          onConfirm={() => removeTarget && remove(removeTarget.id, { onSuccess: () => setRemoveTarget(null) })}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Hand some out — to a person, a department, or both; never more than is left. */
function GiveOutDialog({ row, onClose }: { row: LedgerRow | null; onClose: () => void }) {
  const { mutate: giveOut, isPending } = useGiveOut();
  const [quantity, setQuantity] = useState(1);
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  // Kept through the closing animation, so the dialog does not flash "0 left" as it fades.
  const [shown, setShown] = useState<LedgerRow | null>(null);

  useEffect(() => {
    if (row) { setShown(row); setQuantity(1); setEmployee(""); setDepartment(""); setDate(today()); setNote(""); }
  }, [row]);

  const max = shown?.available ?? 0;
  const ready = !!row && quantity >= 1 && quantity <= max && (!!employee || !!department);

  const submit = () => {
    if (!row || !ready) return;
    giveOut(
      { item: row.item, quantity, employee: employee || undefined, department: department || undefined, date, note: note.trim() || undefined },
      { onSuccess: onClose },
    );
  };

  return (
    <ResponsiveDialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Give out</ResponsiveDialogTitle>
          {shown && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{shown.item} · {max} available</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <div className="flex items-center gap-2">
              <Button type="button" size="icon" variant="outline" aria-label="One fewer" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
              <Input type="number" min={1} max={max} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="w-20 text-center tabular-nums" />
              <Button type="button" size="icon" variant="outline" aria-label="One more" disabled={quantity >= max} onClick={() => setQuantity((q) => Math.min(max, q + 1))}><Plus className="h-4 w-4" /></Button>
              <span className="text-xs text-muted-foreground">of {max}</span>
            </div>
            {quantity > max && <p className="text-xs text-destructive">Only {max} left.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>To a person</Label>
            <EmployeeSelect value={employee} onChange={setEmployee} allowClear placeholder="Pick an employee…" />
          </div>
          <div className="space-y-1.5">
            <Label>Or a department</Label>
            <DepartmentSelect value={department} onChange={setDepartment} allowClear placeholder="Pick a department…" />
            <p className="text-xs text-muted-foreground">One of the two is needed; both is fine.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="give-date">Date</Label>
            <Input id="give-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="give-note">Note</Label>
            <Textarea id="give-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — what it is for" />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Give out {quantity}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
