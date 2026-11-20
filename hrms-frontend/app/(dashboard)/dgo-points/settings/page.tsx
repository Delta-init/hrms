"use client";
import { useEffect, useMemo, useState } from "react";
import { Building2, Layers, ListChecks, Loader2, Pencil, Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  useDgoSettings, useSaveDgoSettings, useSaveDgoProgram, formatAed, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import { RuleDialog } from "@/components/dgo/RuleDialog";
import { DgoGate, Notice, Spinner, TableWrap, STAGE_LABEL, dayLabel, dateTime } from "@/components/dgo/shared";
import type { DgoMe, DgoRule, DgoSettings, DgoSettingsInput, DgoSettingsView, DgoTier } from "@/types";

type Tab = "general" | "rules" | "tiers" | "departments";

/** The settings form, held as text so a half-typed number doesn't jump about. */
interface Draft {
  pointValueAed: string;
  dailyCap: string;
  autoKpiCap: string;
  kpiExceededPct: string;
  expiryMonths: string;
  minRedemption: string;
  revenueSharePct: string;
  tiers: Array<{ minCollections: string; everydayAed: string; eliteAed: string }>;
  effectiveFrom: string;
  note: string;
}

const toDraft = (s: DgoSettings, today: string): Draft => ({
  pointValueAed: String(s.pointValueAed),
  dailyCap: String(s.dailyCap),
  autoKpiCap: String(s.autoKpiCap),
  kpiExceededPct: String(s.kpiExceededPct),
  expiryMonths: String(s.expiryMonths),
  minRedemption: String(s.minRedemption),
  revenueSharePct: String(s.revenueSharePct),
  tiers: s.tiers.map((t) => ({ minCollections: String(t.minCollections), everydayAed: String(t.everydayAed), eliteAed: String(t.eliteAed) })),
  effectiveFrom: today,
  note: "",
});

const num = (v: string) => Number(v.replace(/,/g, ""));

/** What is wrong with the draft, in the words a person would use, or null. */
function problemWith(d: Draft, today: string): string | null {
  const pv = num(d.pointValueAed);
  if (!(pv > 0)) return "The point value must be above 0";
  for (const [label, v] of [["Daily cap", d.dailyCap], ["KPI cap", d.autoKpiCap], ["Expiry", d.expiryMonths], ["Minimum redemption", d.minRedemption]] as const) {
    const n = num(v);
    if (!Number.isInteger(n) || n < 1) return `${label} must be a whole number above 0`;
  }
  if (num(d.autoKpiCap) > num(d.dailyCap)) return "The KPI cap can't be more than the daily cap";
  const ex = num(d.kpiExceededPct);
  if (!(ex > 100)) return "\"Exceeded\" must be above 100%";
  const share = num(d.revenueSharePct);
  if (!(share >= 0 && share <= 100)) return "The revenue share must be 0–100%";
  if (!d.tiers.length) return "Keep at least one tier";
  const tiers = d.tiers.map((t) => ({ min: num(t.minCollections), ev: num(t.everydayAed), el: num(t.eliteAed) }));
  if (tiers.some((t) => !Number.isFinite(t.min) || !Number.isFinite(t.ev) || !Number.isFinite(t.el) || t.min < 0 || t.ev < 0 || t.el < 0)) {
    return "Every tier needs amounts of 0 or more";
  }
  if (tiers[0].min !== 0) return "The first tier must start at AED 0";
  for (let i = 1; i < tiers.length; i++) if (tiers[i].min <= tiers[i - 1].min) return "Tiers must go up in collections";
  if (!d.effectiveFrom || d.effectiveFrom < today) return "Start today or later";
  return null;
}

const fromDraft = (d: Draft): DgoSettingsInput => ({
  pointValueAed: num(d.pointValueAed),
  dailyCap: num(d.dailyCap),
  autoKpiCap: num(d.autoKpiCap),
  kpiExceededPct: num(d.kpiExceededPct),
  expiryMonths: num(d.expiryMonths),
  minRedemption: num(d.minRedemption),
  revenueSharePct: num(d.revenueSharePct),
  tiers: d.tiers.map((t): DgoTier => ({ minCollections: num(t.minCollections), everydayAed: num(t.everydayAed), eliteAed: num(t.eliteAed) })),
  effectiveFrom: d.effectiveFrom,
  note: d.note.trim() || null,
});

export default function DgoSettingsPage() {
  return (
    <DgoGate allow={(me) => me.can.settingsView} deniedText="Rules & Settings is for the people who run DGO Points.">
      {(me) => <SettingsPage me={me} />}
    </DgoGate>
  );
}

function SettingsPage({ me }: { me: DgoMe }) {
  const [tab, setTab] = useState<Tab>("general");
  const { data, isLoading, error } = useDgoSettings();
  const save = useSaveDgoSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftOf, setDraftOf] = useState<number | null>(null);
  const canEdit = me.can.settingsEdit;

  // A fresh draft whenever the version in force changes (after a save, say) —
  // and only then, so a background refetch never wipes what is being typed.
  if (data && data.settings.version !== draftOf) {
    setDraftOf(data.settings.version);
    setDraft(toDraft(data.settings, me.today));
  }

  const problem = draft ? problemWith(draft, me.today) : null;
  const submit = () => {
    if (!draft || problem) return;
    save.mutate(fromDraft(draft));
  };

  return (
    <div>
      <PageHeader
        title="Points Rules"
        description="Every change is saved as a new version from a chosen day. Months already run keep the version they ran on."
        icon={SlidersHorizontal}
      />
      <Tabs
        layoutId="dgo-settings-tabs"
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: "general", label: "General", icon: SlidersHorizontal },
          { key: "rules", label: "Earning rules", icon: ListChecks },
          { key: "tiers", label: "Revenue tiers", icon: Layers },
          { key: "departments", label: "Departments", icon: Building2 },
        ]}
      />
      {isLoading || (data && !draft) ? (
        <Spinner />
      ) : error || !data || !draft ? (
        <Notice text={dgoErrorMessage(error, "The settings couldn't be loaded. Try again in a moment.")} />
      ) : tab === "general" ? (
        <General data={data} draft={draft} setDraft={setDraft} canEdit={canEdit} me={me} problem={problem} saving={save.isPending} onSave={submit} />
      ) : tab === "rules" ? (
        <Rules data={data} canEdit={canEdit} me={me} />
      ) : tab === "tiers" ? (
        <Tiers draft={draft} setDraft={setDraft} canEdit={canEdit} me={me} problem={problem} saving={save.isPending} onSave={submit} pointValueAed={data.settings.pointValueAed} />
      ) : (
        <Departments data={data} canEdit={canEdit} />
      )}
    </div>
  );
}

// ─── General ──────────────────────────────────────────────────────────────────

function SaveBar({
  draft, setDraft, canEdit, me, problem, saving, onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  canEdit: boolean;
  me: DgoMe;
  problem: string | null;
  saving: boolean;
  onSave: () => void;
}) {
  if (!canEdit) return <p className="text-xs text-muted-foreground">You can see these settings but not change them.</p>;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="dgo-from">From</Label>
        <Input id="dgo-from" type="date" min={me.today} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className="sm:w-44" />
      </div>
      <div className="flex-1 space-y-1">
        <Label htmlFor="dgo-note">Why (optional)</Label>
        <Input id="dgo-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={300} placeholder="e.g. approved by management on 20 Nov" />
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {problem && <p className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
        <Button onClick={onSave} disabled={!!problem || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save as new version
        </Button>
      </div>
    </div>
  );
}

function Field({ id, label, hint, value, onChange, disabled, suffix }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; disabled: boolean; suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function General({
  data, draft, setDraft, canEdit, me, problem, saving, onSave,
}: {
  data: DgoSettingsView;
  draft: Draft;
  setDraft: (d: Draft) => void;
  canEdit: boolean;
  me: DgoMe;
  problem: string | null;
  saving: boolean;
  onSave: () => void;
}) {
  const program = useSaveDgoProgram();
  const set = (k: keyof Omit<Draft, "tiers">) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Open to employees</p>
          <p className="text-sm text-muted-foreground">
            {data.program.openToEmployees
              ? "Everyone sees DGO Points in their menu."
              : "Only people with a DGO permission, department heads and Super Admins see it. Switch on when the pilot starts."}
          </p>
        </div>
        <Switch
          checked={data.program.openToEmployees}
          disabled={!canEdit || program.isPending}
          onCheckedChange={(v) => program.mutate({ openToEmployees: v })}
          aria-label="Open DGO Points to employees"
        />
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Points and limits</p>
          <p className="text-xs text-muted-foreground">
            In force: version {data.settings.version}, from {dayLabel(data.settings.effectiveFrom)}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="dgo-pv" label="1 point is worth" value={draft.pointValueAed} onChange={set("pointValueAed")} disabled={!canEdit} suffix="AED"
            hint={num(draft.pointValueAed) > 0 ? `${Math.round(1 / num(draft.pointValueAed))} points = AED 1` : undefined} />
          <Field id="dgo-cap" label="Daily cap" value={draft.dailyCap} onChange={set("dailyCap")} disabled={!canEdit} suffix="pts" hint="Per person, per day" />
          <Field id="dgo-kpicap" label="KPI points a day, at most" value={draft.autoKpiCap} onChange={set("autoKpiCap")} disabled={!canEdit} suffix="pts" />
          <Field id="dgo-ex" label="KPI exceeded at" value={draft.kpiExceededPct} onChange={set("kpiExceededPct")} disabled={!canEdit} suffix="%" />
          <Field id="dgo-exp" label="Points expire after" value={draft.expiryMonths} onChange={set("expiryMonths")} disabled={!canEdit} suffix="months" />
          <Field id="dgo-min" label="Smallest redemption" value={draft.minRedemption} onChange={set("minRedemption")} disabled={!canEdit} suffix="pts" />
          <Field id="dgo-share" label="Revenue departments' share" value={draft.revenueSharePct} onChange={set("revenueSharePct")} disabled={!canEdit} suffix="%"
            hint={`Other departments get ${Math.max(0, 100 - num(draft.revenueSharePct) || 0)}%`} />
        </div>
        <SaveBar draft={draft} setDraft={setDraft} canEdit={canEdit} me={me} problem={problem} saving={saving} onSave={onSave} />
      </Card>

      {data.upcoming.length > 0 && (
        <Card className="space-y-2 p-4">
          <p className="font-semibold">Coming up</p>
          <VersionList versions={data.upcoming} />
        </Card>
      )}

      <Card className="space-y-2 p-4">
        <p className="font-semibold">Version history</p>
        <VersionList versions={data.history} current={data.settings.version} />
      </Card>
    </div>
  );
}

function VersionList({ versions, current }: { versions: DgoSettings[]; current?: number }) {
  if (!versions.length) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {versions.map((v) => (
        <li key={v.version} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
          <span>
            <span className="font-medium">Version {v.version}</span>
            {v.version === current && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">in force</span>}
            <span className="text-muted-foreground"> · from {dayLabel(v.effectiveFrom)} · 1 pt = {formatAed(v.pointValueAed)} · cap {v.dailyCap} · {v.expiryMonths} months</span>
            {v.note && <span className="block text-xs text-muted-foreground">{v.note}</span>}
          </span>
          <span className="text-xs text-muted-foreground">{v.createdByName ?? "System"} · {dateTime(v.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Earning rules ────────────────────────────────────────────────────────────

function Rules({ data, canEdit, me }: { data: DgoSettingsView; canEdit: boolean; me: DgoMe }) {
  const [editing, setEditing] = useState<DgoRule | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 text-right font-medium">Points</th>
                <th className="px-4 py-2 font-medium">Approved by</th>
                <th className="px-4 py-2 font-medium">Version</th>
                <th className="px-4 py-2 font-medium">Status</th>
                {canEdit && <th className="px-4 py-2"><span className="sr-only">Edit</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rules.map((r) => (
                <tr key={r.code} className={cn(!r.active && "text-muted-foreground")}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.code}</td>
                  <td className="min-w-[10rem] px-4 py-2">
                    {r.name}
                    <span className="block text-xs text-muted-foreground">
                      {[r.needsEvidence && "evidence", r.capExempt && "outside daily cap", r.source === "kpi" && "KPI"].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{r.points} <span className="text-xs text-muted-foreground">{formatAed(r.aed)}</span></td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs">{r.chain.length ? r.chain.map((s) => STAGE_LABEL[s]).join(" → ") : "No approval"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">v{r.version} from {dayLabel(r.effectiveFrom)}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      r.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                      r.effectiveFrom > me.today && "bg-sky-500/10 text-sky-700 dark:text-sky-400",
                    )}>
                      {r.effectiveFrom > me.today ? "Starts later" : r.active ? "On" : "Off"}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.code}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div>
        <Button size="sm" variant="outline" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "Hide" : "Show"} every version ({data.ruleHistory.length})
        </Button>
      </div>
      {showHistory && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {data.ruleHistory.map((r) => (
              <li key={`${r.code}-${r.version}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-mono text-xs">{r.code}</span> v{r.version} · {r.points} pts · {r.active ? "on" : "off"} · from {dayLabel(r.effectiveFrom)}
                </span>
                <span className="text-xs text-muted-foreground">{r.createdByName ?? "System"} · {dateTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <RuleDialog
        rule={editing}
        today={me.today}
        pointValueAed={data.settings.pointValueAed}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

// ─── Tiers ────────────────────────────────────────────────────────────────────

function Tiers({
  draft, setDraft, canEdit, me, problem, saving, onSave, pointValueAed,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  canEdit: boolean;
  me: DgoMe;
  problem: string | null;
  saving: boolean;
  onSave: () => void;
  pointValueAed: number;
}) {
  const setTier = (i: number, k: keyof Draft["tiers"][number], v: string) =>
    setDraft({ ...draft, tiers: draft.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });

  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        The month&apos;s confirmed eligible collections pick a tier. The everyday pool pays daily recognition; the elite pool
        pays the monthly achievers and stays locked below the tier that sets it.
      </p>
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">Collections from (AED)</th>
              <th className="px-2 py-2 font-medium">Everyday pool (AED)</th>
              <th className="px-2 py-2 font-medium">Elite pool (AED)</th>
              <th className="px-2 py-2 text-right font-medium">Points a month</th>
              {canEdit && <th className="px-2 py-2"><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody>
            {draft.tiers.map((t, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5"><Input aria-label={`Tier ${i + 1} from`} inputMode="decimal" value={t.minCollections} disabled={!canEdit || i === 0} onChange={(e) => setTier(i, "minCollections", e.target.value)} className="min-w-[8rem]" /></td>
                <td className="px-2 py-1.5"><Input aria-label={`Tier ${i + 1} everyday pool`} inputMode="decimal" value={t.everydayAed} disabled={!canEdit} onChange={(e) => setTier(i, "everydayAed", e.target.value)} className="min-w-[7rem]" /></td>
                <td className="px-2 py-1.5"><Input aria-label={`Tier ${i + 1} elite pool`} inputMode="decimal" value={t.eliteAed} disabled={!canEdit} onChange={(e) => setTier(i, "eliteAed", e.target.value)} className="min-w-[7rem]" /></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {pointValueAed > 0 ? Math.round((num(t.everydayAed) + num(t.eliteAed)) / pointValueAed).toLocaleString("en-US") : "—"}
                </td>
                {canEdit && (
                  <td className="px-2 py-1.5 text-right">
                    <Button size="sm" variant="ghost" disabled={i === 0} aria-label={`Remove tier ${i + 1}`}
                      onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { minCollections: "", everydayAed: "", eliteAed: "0" }] })}>
          <Plus className="h-4 w-4" /> Add tier
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Points a month uses today&apos;s point value. Saving here saves the whole settings version, as on General.</p>
      <SaveBar draft={draft} setDraft={setDraft} canEdit={canEdit} me={me} problem={problem} saving={saving} onSave={onSave} />
    </Card>
  );
}

// ─── Departments ──────────────────────────────────────────────────────────────

function Departments({ data, canEdit }: { data: DgoSettingsView; canEdit: boolean }) {
  const program = useSaveDgoProgram();
  // Keyed on the ids, not the array, so a background refetch keeps what is ticked.
  const savedKey = [...data.program.revenueDepartments].sort().join(",");
  const saved = useMemo(() => new Set(savedKey ? savedKey.split(",") : []), [savedKey]);
  const [picked, setPicked] = useState<Set<string>>(saved);
  useEffect(() => setPicked(new Set(saved)), [saved]);

  const changed = picked.size !== saved.size || Array.from(picked).some((id) => !saved.has(id));
  const staff = (group: "revenue" | "other") =>
    data.departments.filter((d) => (picked.has(d.id) ? "revenue" : "other") === group).reduce((n, d) => n + d.headcount, 0);

  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Tick the departments that bring in revenue. They share {data.settings.revenueSharePct}% of the everyday pool; everyone else shares the rest.
        A change applies to allowances worked out from now on; this month&apos;s figures move when finance recounts staff.
      </p>
      <div className="flex flex-wrap gap-4 text-sm">
        <span>Revenue: <span className="font-semibold">{staff("revenue")} staff</span></span>
        <span>Other: <span className="font-semibold">{staff("other")} staff</span></span>
      </div>
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Revenue</th>
              <th className="px-4 py-2 font-medium">Department</th>
              <th className="px-4 py-2 font-medium">Head</th>
              <th className="px-4 py-2 text-right font-medium">Staff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.departments.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2">
                  <Checkbox
                    checked={picked.has(d.id)}
                    disabled={!canEdit}
                    aria-label={`${d.name} is a revenue department`}
                    onCheckedChange={(v) => setPicked((p) => {
                      const next = new Set(p);
                      if (v === true) next.add(d.id); else next.delete(d.id);
                      return next;
                    })}
                  />
                </td>
                <td className="px-4 py-2 font-medium">{d.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{d.head ?? <span className="text-xs">No head — HR approves</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{d.headcount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {canEdit && (
        <div className="flex justify-end gap-2">
          {changed && <Button variant="outline" onClick={() => setPicked(new Set(saved))} disabled={program.isPending}>Undo changes</Button>}
          <Button disabled={!changed || program.isPending} onClick={() => program.mutate({ revenueDepartments: Array.from(picked) })}>
            {program.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save departments
          </Button>
        </div>
      )}
    </Card>
  );
}
