"use client";
import { useState } from "react";
import { Plane, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMyVisa } from "@/hooks/useVisa";
import { VisaPopup } from "@/components/visa/VisaGate";
import { cn } from "@/lib/utils";
import type { MyVisaStatus } from "@/types";

const DAY_MS = 86_400_000;
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
/** Today in Dubai, where the visa is. */
const todayDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
/** Whole days from today to the expiry, read as the calendar day it was entered for. */
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

function standing(s: MyVisaStatus, left: number | null): { label: string; tone: Tone; note?: string } {
  if (s.pending) return { label: "With HR for checking", tone: "blue", note: s.latest ? `${s.latest.kind === "visa" ? "Your new visa" : "Your renewal receipt"} was sent ${fmtDay(s.latest.submittedAt)}.` : undefined };
  if (s.renewalUntil) return { label: "Renewal in progress", tone: "blue", note: `Send the renewed visa by ${fmtDay(s.renewalUntil)}.` };
  if (s.reason === "returned") return { label: "Sent back by HR", tone: "red", note: s.latest?.reviewNote ?? undefined };
  if (s.reason === "missing" || s.reason === "missing_date" || s.reason === "missing_copy") return { label: "Not on file", tone: "amber" };
  if (left !== null && left < 0) return { label: "Expired", tone: "red" };
  if (left !== null && left <= 30) return { label: "Expiring soon", tone: "amber" };
  return { label: "Current", tone: "green" };
}

/**
 * The employee's own visa: when it runs out, and where it stands. From a
 * month before the expiry it offers to send the renewed one early, so the
 * reminders can stop before the popup has to start.
 */
export function MyVisaCard() {
  const { data: s } = useMyVisa();
  const [open, setOpen] = useState(false);
  if (!s?.applies) return null;

  const left = s.expiryDate ? daysLeft(s.expiryDate) : null;
  const st = standing(s, left);
  const canSendEarly = !s.pending && !s.required && left !== null && left <= 30;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Plane className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Your visa</h3>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[st.tone])}>{st.label}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm sm:max-w-md">
            <div>
              <div className="text-xs text-muted-foreground">Expires</div>
              <div className="font-medium">{s.expiryDate ? fmtDay(s.expiryDate) : "Not on file"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{left !== null && left < 0 ? "Expired" : "Days left"}</div>
              <div className={cn("font-medium tabular-nums", left !== null && left < 0 && "text-destructive")}>
                {left === null ? "—" : left < 0 ? `${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "Today" : left}
              </div>
            </div>
          </div>
          {st.note && <p className="mt-2 text-xs text-muted-foreground">{st.note}</p>}
          {!s.hasCopy && s.expiryDate && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">No copy of the visa is on file.</p>}
        </div>
        {canSendEarly && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Upload className="h-4 w-4" />Send my new visa</Button>
        )}
      </div>
      {open && <VisaPopup status={s} onClose={() => setOpen(false)} />}
    </Card>
  );
}
