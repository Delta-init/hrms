"use client";
import { useState } from "react";
import { FileClock, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMyVisa } from "@/hooks/useVisa";
import { VisaPopup } from "@/components/visa/VisaGate";
import { cn } from "@/lib/utils";
import type { Employee, MyVisaStatus } from "@/types";

const DAY_MS = 86_400_000;
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
/** Today in Dubai — the same clock the reminders run on. */
const todayDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const daysLeft = (iso: string) => {
  const day = new Date(Math.round(new Date(iso).getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayDubai()}T00:00:00Z`)) / DAY_MS);
};

type Tone = "green" | "amber" | "red" | "blue";
const TONE: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  red: "bg-red-500/10 text-red-700 dark:text-red-400",
  blue: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

interface Row { key: string; label: string; expiry: string | null; left: number | null; status: string; tone: Tone; note?: string; isVisa?: boolean }

const byDate = (left: number | null): { status: string; tone: Tone } =>
  left === null ? { status: "Not on file", tone: "amber" }
    : left < 0 ? { status: "Expired", tone: "red" }
    : left <= 30 ? { status: "Expiring soon", tone: "amber" }
    : { status: "Current", tone: "green" };

function visaRow(s: MyVisaStatus): Row {
  const left = s.expiryDate ? daysLeft(s.expiryDate) : null;
  const base = { key: "visa", label: "Visa", expiry: s.expiryDate, left, isVisa: true };
  if (s.pending) return { ...base, status: "With HR for checking", tone: "blue", note: s.latest ? `${s.latest.kind === "visa" ? "Your new visa" : "Your renewal receipt"} was sent ${fmtDay(s.latest.submittedAt)}.` : undefined };
  if (s.renewalUntil) return { ...base, status: "Renewal in progress", tone: "blue", note: `Send the renewed visa by ${fmtDay(s.renewalUntil)}.` };
  if (s.reason === "returned") return { ...base, status: "Sent back by HR", tone: "red", note: s.latest?.reviewNote ?? undefined };
  if (s.reason === "missing" || s.reason === "missing_date" || s.reason === "missing_copy") return { ...base, status: "Not on file", tone: "amber", note: !s.hasCopy && s.expiryDate ? "No copy of the visa is on file." : undefined };
  return { ...base, ...byDate(left) };
}

/**
 * Everything on the employee's record that runs out — visa, passport,
 * Emirates ID, labour card, and the custom documents with a date — with
 * days left and where each stands. The visa can be renewed from here; the
 * rest go to HR, who update the record.
 */
export function MyDocumentsCard({ employee: e }: { employee: Employee }) {
  const { data: visa } = useMyVisa();
  const [sending, setSending] = useState(false);

  const rows: Row[] = [];
  if (visa?.applies) rows.push(visaRow(visa));
  const dated = (key: string, label: string, expiry?: string | null) => {
    if (!expiry) return;
    const left = daysLeft(expiry);
    rows.push({ key, label, expiry, left, ...byDate(left) });
  };
  dated("passport", "Passport", e.passport?.expiryDate);
  dated("emiratesId", "Emirates ID", e.emiratesId?.expiryDate);
  dated("labourCard", "Labour card", e.labourCard?.expiryDate);
  for (const o of e.otherDocuments ?? []) dated(`other:${o._id}`, o.label || "Document", o.expiryDate);
  if (!rows.length) return null;

  // Soonest first: what needs doing is at the top.
  rows.sort((a, b) => (a.left ?? -Infinity) - (b.left ?? -Infinity));
  const v = visa;
  const canSendVisa = !!v && !v.pending && !v.required && v.expiryDate !== null && daysLeft(v.expiryDate) <= 30;
  const needsHr = rows.some((r) => !r.isVisa && r.left !== null && r.left <= 30);

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileClock className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Your documents</h3>
          <p className="text-xs text-muted-foreground">When each one runs out. You&apos;ll get a reminder 30 days before.</p>
          <ul className="mt-3 divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.label}</div>
                  {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                  {r.isVisa && canSendVisa && (
                    <Button variant="outline" size="sm" className="mt-1.5 h-7" onClick={() => setSending(true)}><Upload className="h-3.5 w-3.5" />Send my new visa</Button>
                  )}
                </div>
                <div className="text-right text-sm tabular-nums">
                  <div>{r.expiry ? fmtDay(r.expiry) : "—"}</div>
                  <div className={cn("text-xs", r.left !== null && r.left < 0 ? "text-destructive" : "text-muted-foreground")}>
                    {r.left === null ? "" : r.left < 0 ? `${-r.left} day${r.left === -1 ? "" : "s"} ago` : r.left === 0 ? "today" : `${r.left} day${r.left === 1 ? "" : "s"} left`}
                  </div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[r.tone])}>{r.status}</span>
              </li>
            ))}
          </ul>
          {needsHr && <p className="mt-2 text-xs text-muted-foreground">For documents other than the visa, give the renewed one to HR — they update your record.</p>}
        </div>
      </div>
      {sending && v && <VisaPopup status={v} onClose={() => setSending(false)} />}
    </Card>
  );
}
