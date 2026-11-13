"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateAdSpendSettings } from "@/hooks/useAdSpend";
import type { AdSpendSettings } from "@/types";
import { dayLabel, mondayOf, weekLabel } from "./format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AdSpendSettings;
}

type PlatformRow = { key?: string; label: string; active: boolean; id: string };
let seq = 0;

/**
 * Where the company advertises, what it means to spend a month, and from
 * which week the recruiter owes a weekly log — which is also what turns the
 * Monday and Wednesday reminders on.
 */
export function AdSpendSettingsDialog({ open, onOpenChange, settings }: Props) {
  const save = useUpdateAdSpendSettings();
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("");
  const [from, setFrom] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlatforms(settings.platforms.map((p) => ({ ...p, id: `p${++seq}` })));
    setBudget(settings.monthlyBudget ? String(settings.monthlyBudget) : "");
    setCurrency(settings.currency);
    setFrom(settings.trackingFrom ?? "");
    setError(null);
  }, [open, settings]);

  const submit = () => {
    setError(null);
    const named = platforms.filter((p) => p.label.trim());
    if (!named.some((p) => p.active)) { setError("Keep at least one platform switched on"); return; }
    const amount = budget.trim() ? Number(budget.replace(/,/g, "")) : 0;
    if (!Number.isFinite(amount) || amount < 0) { setError("The budget must be a number"); return; }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) { setError("Currency is a three-letter code, like AED"); return; }
    save.mutate(
      {
        platforms: named.map(({ key, label, active }) => ({ ...(key ? { key } : {}), label: label.trim(), active })),
        monthlyBudget: amount,
        currency: currency.trim().toUpperCase(),
        trackingFrom: from ? mondayOf(from) : null,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Ad spend settings</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="space-y-5 px-4 sm:px-0">
          <div className="space-y-2">
            <Label>Platforms</Label>
            <p className="text-xs text-muted-foreground">Switching one off hides it from new weeks; weeks already logged keep it. These names are also the candidate form’s “source” list.</p>
            <div className="space-y-2">
              {platforms.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Input className="h-9" value={p.label} placeholder="Bayt" maxLength={40}
                    onChange={(e) => setPlatforms((ps) => ps.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)))} />
                  <Switch checked={p.active} aria-label={`${p.label || "Platform"} in use`}
                    onCheckedChange={(v) => setPlatforms((ps) => ps.map((x) => (x.id === p.id ? { ...x, active: v } : x)))} />
                  {!p.key && (
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove"
                      onClick={() => setPlatforms((ps) => ps.filter((x) => x.id !== p.id))}><X className="h-4 w-4" /></Button>
                  )}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setPlatforms((ps) => [...ps, { label: "", active: true, id: `p${++seq}` }])}>
              <Plus className="h-4 w-4" />Add platform
            </Button>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="budget">Monthly budget</Label>
              <Input id="budget" inputMode="decimal" placeholder="4000" value={budget} onChange={(e) => setBudget(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Leave empty for no budget.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="from">Weekly log owed from</Label>
            <Input id="from" type="date" value={from} max={settings.today} onChange={(e) => setFrom(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              {from
                ? `From the week of ${weekLabel(mondayOf(from))}. Whoever logs the spend is reminded on Monday, and again on Wednesday if last week is still missing.`
                : "Not set — no reminders, and no week shows as missing."}
              {from && mondayOf(from) !== from ? ` (${dayLabel(from)} is mid-week, so that week counts from its Monday.)` : ""}
            </p>
            {from && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setFrom("")}>Turn reminders off</button>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
