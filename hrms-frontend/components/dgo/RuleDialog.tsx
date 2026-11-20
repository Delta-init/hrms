"use client";
import { useEffect, useState } from "react";
import { ArrowDown, Loader2, Save } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useSaveDgoRule, formatAed } from "@/hooks/useDgoPoints";
import { STAGE_LABEL } from "@/components/dgo/shared";
import type { DgoRule, DgoStage } from "@/types";

/** The chain always runs in this order; ticking picks which steps apply. */
const STAGES: DgoStage[] = ["head", "hr", "finance"];

/**
 * Editing a rule saves a new version from a chosen day. Awards already made keep
 * the version they were made under, so a change never rewrites history.
 */
export function RuleDialog({
  rule, today, pointValueAed, open, onOpenChange,
}: {
  rule: DgoRule | null;
  today: string;
  pointValueAed: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveDgoRule();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("0");
  const [needsEvidence, setNeedsEvidence] = useState(false);
  const [chain, setChain] = useState<DgoStage[]>([]);
  const [capExempt, setCapExempt] = useState(false);
  const [active, setActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(today);

  useEffect(() => {
    if (!open || !rule) return;
    setName(rule.name);
    setDescription(rule.description);
    setPoints(String(rule.points));
    setNeedsEvidence(rule.needsEvidence);
    setChain(rule.chain);
    setCapExempt(rule.capExempt);
    setActive(rule.active);
    setEffectiveFrom(today);
  }, [open, rule, today]);

  const n = Number(points);
  const missing =
    !name.trim() ? "Give it a name"
      : !Number.isInteger(n) || n < 1 ? "Points must be a whole number above 0"
        : !effectiveFrom || effectiveFrom < today ? "Start today or later"
          : null;

  const toggleStage = (s: DgoStage, on: boolean) =>
    setChain((c) => STAGES.filter((x) => (x === s ? on : c.includes(x))));

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit {rule?.code}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            Saves version {rule ? rule.version + 1 : ""}. Awards already made keep the version they were made under.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="dgo-rule-name">Name</Label>
            <Input id="dgo-rule-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-rule-desc">What earns it</Label>
            <Textarea id="dgo-rule-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dgo-rule-points">Points</Label>
              <Input id="dgo-rule-points" type="number" min={1} step={1} value={points} onChange={(e) => setPoints(e.target.value)} />
              {Number.isFinite(n) && n > 0 && <p className="text-xs text-muted-foreground">= {formatAed(Math.round(n * pointValueAed * 100) / 100)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dgo-rule-from">From</Label>
              <Input id="dgo-rule-from" type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Who approves, in order</Label>
            {rule?.source === "kpi" && (
              <p className="text-xs text-muted-foreground">KPI points are confirmed by the person who records them; leave these empty to post straight away.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {STAGES.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <ArrowDown className="h-3 w-3 -rotate-90 text-muted-foreground" />}
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                    <Checkbox checked={chain.includes(s)} onCheckedChange={(v) => toggleStage(s, v === true)} />
                    {STAGE_LABEL[s]}
                  </label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">A department with no head skips that step. Nobody approves an award they recorded or one made to them.</p>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Needs evidence</span>
              <Switch checked={needsEvidence} onCheckedChange={setNeedsEvidence} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Outside the daily cap <span className="text-xs text-muted-foreground">(still inside the budget)</span></span>
              <Switch checked={capExempt} onCheckedChange={setCapExempt} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Switched on</span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          </div>
        </div>

        <ResponsiveDialogFooter>
          {missing && <p className="mr-auto self-center text-xs text-muted-foreground">{missing}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button
            disabled={!!missing || save.isPending || !rule}
            onClick={() =>
              rule &&
              save.mutate(
                {
                  code: rule.code, name: name.trim(), description: description.trim(), points: n,
                  needsEvidence, chain, capExempt, active, effectiveFrom,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save new version
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
