"use client";
import { useEffect, useMemo, useState } from "react";
import { Building2, Gift, Layers, ListChecks, Loader2, Pencil, Plus, Save, SlidersHorizontal, Trash2, Users, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useDgoSettings, useSaveDgoSettings, useSaveDgoProgram, useDgoPeople, formatAed, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import { AsyncSelect } from "@/components/ui/async-select";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RuleDialog } from "@/components/dgo/RuleDialog";
import { DgoGate, Notice, Spinner, TableWrap, STAGE_LABEL, dayLabel, dateTime } from "@/components/dgo/shared";
import type {
  DgoAudience, DgoEliteCategory, DgoEliteMetric, DgoLeaderboardVisibility, DgoMe, DgoPilotPerson, DgoRule, DgoSettings, DgoSettingsInput,
  DgoSettingsView, DgoTier,
} from "@/types";

type Tab = "general" | "rules" | "tiers" | "departments" | "recognition";

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
          { key: "recognition", label: "Store & achievers", icon: Gift },
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
      ) : tab === "departments" ? (
        <Departments data={data} canEdit={canEdit} />
      ) : (
        <Recognition data={data} canEdit={canEdit} />
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
              ? data.program.audience === "pilot"
                ? "The pilot group below sees DGO Points in their menu."
                : "Everyone sees DGO Points in their menu."
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

      {data.program.audience !== undefined && <Audience data={data} canEdit={canEdit} />}

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

// ─── Who it's open to (pilot) ─────────────────────────────────────────────────

const AUDIENCE: Array<{ value: DgoAudience; label: string; hint: string }> = [
  { value: "everyone", label: "Everyone", hint: "Every employee sees and earns points once it's switched on." },
  { value: "pilot", label: "A pilot group", hint: "Only the departments and people below." },
];

/**
 * Everyone, or a pilot group of departments and named people. Held as a draft
 * and saved in one go, so ticking three departments isn't three saves.
 */
function Audience({ data, canEdit }: { data: DgoSettingsView; canEdit: boolean }) {
  const program = useSaveDgoProgram();
  const savedAudience: DgoAudience = data.program.audience ?? "everyone";
  const savedDepts = data.program.pilotDepartments ?? [];
  const savedPeople = data.program.pilotEmployees ?? [];
  // Keyed on ids, so a background refetch doesn't wipe what is being picked.
  const savedKey = `${savedAudience}|${[...savedDepts].sort().join(",")}|${savedPeople.map((p) => p.id).sort().join(",")}`;
  const [audience, setAudience] = useState<DgoAudience>(savedAudience);
  const [depts, setDepts] = useState<Set<string>>(new Set(savedDepts));
  const [people, setPeople] = useState<DgoPilotPerson[]>(savedPeople);
  useEffect(() => {
    setAudience(savedAudience);
    setDepts(new Set(savedDepts));
    setPeople(savedPeople);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const draftKey = `${audience}|${Array.from(depts).sort().join(",")}|${people.map((p) => p.id).sort().join(",")}`;
  const changed = draftKey !== savedKey;
  const emptyPilot = audience === "pilot" && depts.size === 0 && people.length === 0;
  const deptStaff = data.departments.filter((d) => depts.has(d.id)).reduce((n, d) => n + d.headcount, 0);

  const save = () => program.mutate({
    audience,
    pilotDepartments: Array.from(depts),
    pilotEmployees: people.map((p) => p.id),
  });

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-muted-foreground" /> Who it&apos;s open to</p>
        <p className="text-sm text-muted-foreground">
          With a pilot group, only those people see and earn points, and each month&apos;s budget is split by the pilot&apos;s headcount while it runs.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {AUDIENCE.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={!canEdit}
            onClick={() => setAudience(a.value)}
            className={cn(
              "rounded-xl border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed",
              audience === a.value ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-muted/50",
            )}
            aria-pressed={audience === a.value}
          >
            <p className="font-medium">{a.label}</p>
            <p className="text-xs text-muted-foreground">{a.hint}</p>
          </button>
        ))}
      </div>

      {audience === "pilot" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Departments in the pilot</p>
            <div className="flex flex-wrap gap-2">
              {data.departments.map((d) => {
                const on = depts.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setDepts((s) => {
                      const next = new Set(s);
                      if (on) next.delete(d.id); else next.add(d.id);
                      return next;
                    })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
                    )}
                    aria-pressed={on}
                  >
                    {d.name} <span className={cn("tabular-nums", on ? "opacity-80" : "opacity-60")}>· {d.headcount}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">And these people</p>
            <p className="text-xs text-muted-foreground">For someone in a department that isn&apos;t in the pilot.</p>
            {canEdit && (
              <PilotPersonPicker
                exclude={people.map((p) => p.id)}
                onPick={(p) => setPeople((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]))}
              />
            )}
            {people.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <span key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.department && <span className="truncate text-muted-foreground">· {p.department}</span>}
                    {canEdit && (
                      <button
                        type="button"
                        className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        onClick={() => setPeople((list) => list.filter((x) => x.id !== p.id))}
                        aria-label={`Remove ${p.name} from the pilot`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nobody added by name.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {!changed && typeof data.program.pilotHeadcount === "number" ? (
              <span>In the pilot now: <span className="font-semibold tabular-nums">{data.program.pilotHeadcount} active staff</span></span>
            ) : (
              <span className="text-muted-foreground">
                About <span className="font-semibold tabular-nums text-foreground">{deptStaff + people.length}</span> staff
                {" "}(the exact count shows once saved)
              </span>
            )}
          </div>
          {emptyPilot && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Pick at least one department or person, or nobody will see DGO Points.</p>
          )}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {changed && (
            <Button
              variant="outline"
              disabled={program.isPending}
              onClick={() => { setAudience(savedAudience); setDepts(new Set(savedDepts)); setPeople(savedPeople); }}
            >
              Undo changes
            </Button>
          )}
          <Button disabled={!changed || program.isPending} onClick={save}>
            {program.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save who it&apos;s open to
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Search anyone active and add them to the pilot by name. */
function PilotPersonPicker({ exclude, onPick }: { exclude: string[]; onPick: (p: DgoPilotPerson) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const { data = [], isFetching } = useDgoPeople(debounced.trim());
  const options = data
    .filter((p) => !exclude.includes(p.id))
    .map((p) => ({ value: p.id, label: p.name, sub: [p.department, p.designation].filter(Boolean).join(" · ") || undefined }));
  return (
    <AsyncSelect
      value=""
      onChange={(id) => {
        const p = data.find((x) => x.id === id);
        if (p) onPick({ id: p.id, name: p.name, department: p.department });
        setSearch("");
      }}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder="Add a person…"
      searchPlaceholder="Search by name…"
      emptyText="Nobody found."
      className="w-full sm:max-w-sm"
    />
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

// ─── Store & achievers ────────────────────────────────────────────────────────

const VISIBILITY: Array<{ value: DgoLeaderboardVisibility; label: string; hint: string }> = [
  { value: "everyone", label: "Everyone sees the whole company", hint: "Every employee sees the full ranking." },
  { value: "department", label: "Employees see their own department", hint: "Managers and HR still see everyone." },
  { value: "managers", label: "Managers only", hint: "Employees see only their own rank. Heads see their departments; HR sees everyone." },
];

const METRIC_LABEL: Record<DgoEliteMetric, string> = {
  sales: "Own sales (AED)",
  team: "Team sales (AED)",
  cs: "CS collections (AED)",
  cs_department: "CS department total (AED)",
  mentor_chief: "Chief mentor KPI score",
  mentor_senior: "Senior mentor KPI score",
  mentor_junior: "Junior mentor KPI score",
};

interface CatDraft { code: string; name: string; metric: DgoEliteMetric; place: number; threshold: string; prizeAed: string; active: boolean }

const toCatDraft = (c: DgoEliteCategory): CatDraft => ({ ...c, threshold: String(c.threshold), prizeAed: String(c.prizeAed) });

function Recognition({ data, canEdit }: { data: DgoSettingsView; canEdit: boolean }) {
  const program = useSaveDgoProgram();
  const p = data.program;
  const savedVisibility = p.leaderboardVisibility ?? "everyone";
  const savedPerMonth = p.nominationsPerMonth ?? 4;
  // Keyed on the content, not the array, so a background refetch keeps what is being typed.
  const savedCatsKey = JSON.stringify(p.eliteCategories ?? []);
  const savedCats = useMemo<DgoEliteCategory[]>(() => JSON.parse(savedCatsKey), [savedCatsKey]);

  const [visibility, setVisibility] = useState<DgoLeaderboardVisibility>(savedVisibility);
  const [perMonth, setPerMonth] = useState(String(savedPerMonth));
  const [cats, setCats] = useState<CatDraft[]>(() => savedCats.map(toCatDraft));
  // Back to what is saved whenever the server's copy changes (after a save), never on a mere refetch.
  useEffect(() => { setVisibility(savedVisibility); setPerMonth(String(savedPerMonth)); }, [savedVisibility, savedPerMonth]);
  useEffect(() => setCats(savedCats.map(toCatDraft)), [savedCats]);

  const perMonthNum = Number(perMonth);
  const perMonthOk = Number.isInteger(perMonthNum) && perMonthNum >= 0 && perMonthNum <= 100;
  const storeChanged = visibility !== savedVisibility || perMonthNum !== savedPerMonth;

  const eliteCeiling = Math.max(0, ...data.settings.tiers.map((t) => t.eliteAed)) || 13250;
  const prizeTotal = cats.filter((c) => c.active).reduce((s, c) => s + (Number(c.prizeAed) || 0), 0);
  const catProblem = cats.map((c) => {
    const th = Number(c.threshold);
    const pr = Number(c.prizeAed);
    if (c.name.trim().length < 2) return `${c.code}: give it a name`;
    if (!(th >= 0)) return `${c.name}: the threshold must be 0 or more`;
    if (c.metric.startsWith("mentor_") && th > 100) return `${c.name}: a score threshold is out of 100`;
    if (!(pr >= 0)) return `${c.name}: the prize must be 0 or more`;
    return null;
  }).find(Boolean) ?? null;
  const catsChanged = JSON.stringify(cats.map((c) => ({ ...c, threshold: Number(c.threshold), prizeAed: Number(c.prizeAed) }))) !==
    JSON.stringify(savedCats.map((c) => ({ code: c.code, name: c.name, metric: c.metric, place: c.place, threshold: c.threshold, prizeAed: c.prizeAed, active: c.active })));
  const setCat = (i: number, patch: Partial<CatDraft>) => setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-4">
        <p className="font-semibold">Store &amp; recognition</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Who sees the leaderboard</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as DgoLeaderboardVisibility)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VISIBILITY.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{VISIBILITY.find((o) => o.value === visibility)?.hint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-nom-limit">Nominations each person can send a month</Label>
            <Input id="dgo-nom-limit" inputMode="numeric" value={perMonth} onChange={(e) => setPerMonth(e.target.value)} disabled={!canEdit} className="sm:w-32" />
            <p className="text-xs text-muted-foreground">Counts every nomination sent, approved or not. 0 switches nominations off.</p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex items-center justify-end gap-2">
            {!perMonthOk && <p className="mr-auto text-xs text-red-600 dark:text-red-400">The limit must be a whole number from 0 to 100</p>}
            <Button
              disabled={!storeChanged || !perMonthOk || program.isPending}
              onClick={() => program.mutate({ leaderboardVisibility: visibility, nominationsPerMonth: perMonthNum })}
            >
              {program.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">You can see these settings but not change them.</p>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Monthly achievers</p>
          <p className={cn("text-xs", prizeTotal > eliteCeiling ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            Prizes switched on: {formatAed(prizeTotal)} of the {formatAed(eliteCeiling)} elite pool
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Paid from the elite pool, only in a month whose confirmed collections reach the elite tier. A change applies to months not yet fetched.
          Sales and team-leader prizes skip anyone who took a gift that month.
        </p>
        {cats.length === 0 ? (
          <p className="text-sm text-muted-foreground">The achiever categories show here once the server has been updated.</p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">On</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Measured by</th>
                  <th className="px-2 py-2 font-medium">Place</th>
                  <th className="px-2 py-2 font-medium">Qualifies at</th>
                  <th className="px-2 py-2 font-medium">Prize (AED)</th>
                  <th className="px-2 py-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cats.map((c, i) => {
                  const mentor = c.metric.startsWith("mentor_");
                  return (
                    <tr key={c.code} className={cn(!c.active && "text-muted-foreground")}>
                      <td className="px-2 py-1.5">
                        <Switch checked={c.active} disabled={!canEdit} onCheckedChange={(v) => setCat(i, { active: v })} aria-label={`${c.name} on`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`${c.code} name`} value={c.name} disabled={!canEdit} onChange={(e) => setCat(i, { name: e.target.value })} maxLength={60} className="min-w-[10rem]" />
                        {mentor && (
                          <span className="mt-1 block max-w-[16rem] text-[11px] text-muted-foreground">
                            Switched off until management sets the criteria; the threshold is a score out of 100.
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">{METRIC_LABEL[c.metric]}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">{c.place === 1 ? "1st" : c.place === 2 ? "2nd" : `${c.place}th`}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Input aria-label={`${c.name} threshold`} inputMode="decimal" value={c.threshold} disabled={!canEdit} onChange={(e) => setCat(i, { threshold: e.target.value })} className="min-w-[6.5rem]" />
                          <span className="text-xs text-muted-foreground">{mentor ? "/100" : "AED"}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`${c.name} prize`} inputMode="decimal" value={c.prizeAed} disabled={!canEdit} onChange={(e) => setCat(i, { prizeAed: e.target.value })} className="min-w-[6rem]" />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {data.settings.pointValueAed > 0 ? Math.round((Number(c.prizeAed) || 0) / data.settings.pointValueAed).toLocaleString("en-US") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {canEdit && cats.length > 0 && (
          <div className="flex items-center justify-end gap-2">
            {catProblem && <p className="mr-auto text-xs text-red-600 dark:text-red-400">{catProblem}</p>}
            {catsChanged && <Button variant="outline" onClick={() => setCats(savedCats.map(toCatDraft))} disabled={program.isPending}>Undo changes</Button>}
            <Button
              disabled={!catsChanged || !!catProblem || program.isPending}
              onClick={() => program.mutate({
                eliteCategories: cats.map((c) => ({
                  code: c.code, name: c.name.trim(), metric: c.metric, place: c.place,
                  threshold: Number(c.threshold), prizeAed: Number(c.prizeAed), active: c.active,
                })),
              })}
            >
              {program.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save categories
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
