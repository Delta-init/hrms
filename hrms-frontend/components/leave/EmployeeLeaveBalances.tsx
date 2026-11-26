"use client";
import { useEffect, useState } from "react";
import { History, Loader2, Pencil, Users } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { cn } from "@/lib/utils";
import { useEmployeeLeaveBalances, useAdjustLeaveBalance } from "@/hooks/useLeaveBalances";
import { leaveTypeLabel, type LeaveBalance } from "@/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Anyone's leave balances, and editing them (2026-11-26) — for HR (leave edit) and the Super Admin. An edit sets the
 * days left, or adds or removes days, with a reason; it is saved as an adjustment, so the policy keeps applying.
 */
export function EmployeeLeaveBalances() {
  const thisYear = new Date().getFullYear();
  const [employeeId, setEmployeeId] = useState("");
  const [year, setYear] = useState(thisYear);
  const { data, isLoading, error } = useEmployeeLeaveBalances(employeeId || null, year);
  const [editing, setEditing] = useState<LeaveBalance | null>(null);
  const err = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Employee balances</h3></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64"><EmployeeSelect value={employeeId} onChange={setEmployeeId} placeholder="Choose an employee" /></div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>{[thisYear, thisYear - 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {!employeeId ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Choose someone to see and edit their leave balance.</p>
      ) : isLoading ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : err ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{err}</p>
      ) : !data?.balances.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No leave policies apply to {data?.employee.name ?? "them"}.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.balances.map((b) => {
              const editable = b.period !== "month" || year === thisYear;
              return (
                <div key={b.type} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {b.label || leaveTypeLabel(b.type)}{b.period === "month" && <span className="ml-1 normal-case">· {MONTHS[new Date().getMonth()]}</span>}
                    </p>
                    {editable && <Button size="sm" variant="ghost" className="-mr-2 -mt-1 h-7" onClick={() => setEditing(b)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
                  </div>
                  <p className={cn("mt-1 text-2xl font-bold tabular-nums", b.balance < 0 ? "text-red-500" : "text-primary")}>{b.balance}<span className="ml-1 text-sm font-normal text-muted-foreground">days left</span></p>
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>{b.period === "month" ? "This month" : "Granted"}</span><span className="tabular-nums">{b.accrued}</span></div>
                    {b.carriedForward > 0 && <div className="flex justify-between"><span>Carried forward</span><span className="tabular-nums text-emerald-600">+{b.carriedForward}</span></div>}
                    {!!b.adjustment && <div className="flex justify-between"><span>Adjusted</span><span className={cn("tabular-nums", b.adjustment > 0 ? "text-emerald-600" : "text-red-500")}>{b.adjustment > 0 ? "+" : ""}{b.adjustment}</span></div>}
                    <div className="flex justify-between"><span>Used</span><span className="tabular-nums">−{b.used}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {data.history.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><History className="h-3.5 w-3.5" />Changes made</p>
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {data.history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
                    <span>
                      <span className="font-medium">{data.balances.find((b) => b.type === h.type)?.label || leaveTypeLabel(h.type)}{h.month ? ` (${MONTHS[h.month - 1]})` : ""}</span>
                      <span className="tabular-nums"> {h.from} → {h.to} days</span>
                      <span className={cn("ml-1 tabular-nums text-xs", h.delta > 0 ? "text-emerald-600" : "text-red-500")}>({h.delta > 0 ? "+" : ""}{h.delta})</span>
                      <span className="block text-xs text-muted-foreground">{h.reason}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{[h.byName, new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <EditDialog employeeId={employeeId} name={data?.employee.name ?? ""} year={year} balance={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </Card>
  );
}

function EditDialog({ employeeId, name, year, balance, onOpenChange }: { employeeId: string; name: string; year: number; balance: LeaveBalance | null; onOpenChange: (o: boolean) => void }) {
  const { mutate, isPending } = useAdjustLeaveBalance();
  const [mode, setMode] = useState<"set" | "add">("set");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (balance) { setMode("set"); setValue(String(balance.balance)); setReason(""); setError(""); } }, [balance]);
  if (!balance) return null;

  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n);
  const to = valid ? round(mode === "set" ? n : balance.balance + n) : balance.balance;
  const delta = round(to - balance.balance);
  const label = balance.label || leaveTypeLabel(balance.type);

  const submit = () => {
    if (!valid) { setError("Enter a number of days"); return; }
    if (delta === 0) { setError("That's the balance it already has"); return; }
    if (reason.trim().length < 3) { setError("Say why the balance is changing"); return; }
    mutate({ employeeId, data: { type: balance.type, year, mode, days: n, reason: reason.trim() } }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={!!balance} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit {label} balance</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            {name} · {balance.period === "month" ? `${MONTHS[new Date().getMonth()]} ${year}` : year} · now {balance.balance} days left
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div role="radiogroup" aria-label="How to change it" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {([["set", "Set days left"], ["add", "Add or remove days"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k}
                onClick={() => { setMode(k); setValue(k === "set" ? String(balance.balance) : ""); setError(""); }}
                className={cn("rounded-md px-2 py-1.5 text-sm font-medium", mode === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lb-days">{mode === "set" ? "Days left" : "Days to add (use a minus to remove)"}</Label>
            <Input id="lb-days" type="number" step="0.5" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "add" ? "2 or -1.5" : ""} autoFocus />
          </div>
          {valid && delta !== 0 && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
              {balance.balance} → <b>{to} days</b> <span className="tabular-nums">({delta > 0 ? "+" : ""}{delta})</span>
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lb-reason">Reason *</Label>
            <Textarea id="lb-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Two days owed for working the Eid weekend" />
            <p className="text-xs text-muted-foreground">{name.split(" ")[0] || "They"} will see the change and this reason in their notices.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save balance</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
