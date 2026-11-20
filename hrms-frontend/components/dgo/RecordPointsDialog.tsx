"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDgoRules, useRecordDgoPoints, formatAed } from "@/hooks/useDgoPoints";
import { DgoPersonSelect, STAGE_LABEL } from "@/components/dgo/shared";
import type { DgoMe } from "@/types";

/** A fresh id per opening of the form, so a double submit records once. */
const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Record points for somebody: a department head for their own people, HR for
 * anyone. KPI points post straight away; recognition goes through its chain.
 */
export function RecordPointsDialog({ me, open, onOpenChange }: { me: DgoMe; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: rulesView } = useDgoRules(open);
  const record = useRecordDgoPoints();

  const [employeeId, setEmployeeId] = useState("");
  const [ruleCode, setRuleCode] = useState("");
  const [day, setDay] = useState(me.today);
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [kpiKey, setKpiKey] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);

  // Every opening is a new request: a new id, a clean form.
  useEffect(() => {
    if (!open) return;
    setEmployeeId(""); setRuleCode(""); setDay(me.today); setReason(""); setEvidenceNote(""); setKpiKey("");
    setRequestId(newRequestId());
  }, [open, me.today]);

  const rules = useMemo(() => (rulesView?.rules ?? []).filter((r) => r.active), [rulesView]);
  const rule = rules.find((r) => r.code === ruleCode);
  const missing =
    !employeeId ? "Choose a person"
      : !rule ? "Choose what it is for"
        : !day ? "Pick the day"
          : day > me.today ? "The day can't be in the future"
            : !reason.trim() ? "Say what they did"
              : rule.needsEvidence && !evidenceNote.trim() ? "This one needs evidence"
                : null;

  const submit = () => {
    if (missing || !rule) return;
    record.mutate(
      {
        employeeId,
        ruleCode: rule.code,
        day,
        reason: reason.trim(),
        ...(evidenceNote.trim() ? { evidenceNote: evidenceNote.trim() } : {}),
        ...(rule.source === "kpi" && kpiKey.trim() ? { kpiKey: kpiKey.trim() } : {}),
        requestId,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Record points</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            Nobody can record points for themselves. Recognition goes for approval; KPI points post straight away.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Person</Label>
            <DgoPersonSelect value={employeeId} onChange={setEmployeeId} className="w-full" />
          </div>

          <div className="space-y-1.5">
            <Label>For</Label>
            <Select value={ruleCode} onValueChange={setRuleCode}>
              <SelectTrigger><SelectValue placeholder="Choose a rule…" /></SelectTrigger>
              <SelectContent>
                {rules.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.name} · {r.points} pts
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rule && (
              <p className="text-xs text-muted-foreground">
                {rule.points} points = {formatAed(rule.aed)}.{" "}
                {rule.chain.length ? `Approved by ${rule.chain.map((s) => STAGE_LABEL[s]).join(", then ")}.` : "Posts as soon as you save."}
                {rule.capExempt ? " Outside the daily cap." : ""}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dgo-day">Day</Label>
              <Input id="dgo-day" type="date" value={day} max={me.today} onChange={(e) => setDay(e.target.value)} />
            </div>
            {rule?.source === "kpi" && (
              <div className="space-y-1.5">
                <Label htmlFor="dgo-kpi">KPI (optional)</Label>
                <Input id="dgo-kpi" value={kpiKey} onChange={(e) => setKpiKey(e.target.value)} placeholder="e.g. calls" maxLength={40} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dgo-reason">What they did</Label>
            <Textarea id="dgo-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Short and specific — this is what the approvers read." />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dgo-evidence">Evidence {rule?.needsEvidence ? "(required)" : "(optional)"}</Label>
            <Textarea id="dgo-evidence" rows={2} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} maxLength={1000} placeholder="Where to see it: a ticket number, a review, a link…" />
          </div>
        </div>

        <ResponsiveDialogFooter>
          {missing && <p className="mr-auto self-center text-xs text-muted-foreground">{missing}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={record.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!!missing || record.isPending}>
            {record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Record
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
