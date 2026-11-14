"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, ChevronDown, ChevronUp, Clock, FileText, Loader2, Plane, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClockCard } from "@/components/dashboard/ClockCard";
import { useAuth } from "@/hooks/useAuth";
import { useMyVisa, useSubmitMyVisa } from "@/hooks/useVisa";
import { useGuideSeen } from "@/hooks/useGuide";
import { cn } from "@/lib/utils";
import type { MyVisaStatus } from "@/types";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
};
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function reasonText(s: MyVisaStatus): string {
  switch (s.reason) {
    case "missing": return "HR doesn't have your visa on file yet.";
    case "missing_date": return "Your visa's expiry date is missing.";
    case "missing_copy": return "A copy of your visa is missing.";
    case "expired": return s.expiryDate ? `Your visa expired on ${fmtDay(s.expiryDate)}. Add the renewed one.` : "Your visa has expired. Add the renewed one.";
    case "returned": return s.latest?.reviewNote ? `HR sent back your last one: “${s.latest.reviewNote}”` : "HR sent back your last one.";
    default: return "";
  }
}

/**
 * Stops Dubai-based staff until their visa is on file: the expiry date and a
 * copy, both required, checked by HR before they count. There is no way to
 * close it — no ✕, Escape and clicking outside do nothing — except one: the
 * clock card is inside, so nobody is marked late for not having their visa to
 * hand. Once sent, it steps aside while HR checks it.
 *
 * Not for the kiosk tablet, an impersonating admin, or anyone still in the
 * onboarding wizard, which comes first.
 */
export function VisaGate() {
  const { data: session, status } = useSession();
  const { isKioskOnly } = useAuth();
  const pathname = usePathname();
  const impersonating = !!session?.impersonatedBy;
  const profileDone = (session?.user as { profileCompleted?: boolean } | undefined)?.profileCompleted === true;
  const ready = status === "authenticated" && !impersonating && !isKioskOnly && profileDone && !pathname.startsWith("/onboarding");
  const { data: visa } = useMyVisa(ready);
  // The welcome video opens once, on the dashboard, drawn above everything —
  // and as a modal this would take every click from it, leaving a video on
  // screen that nothing can close. So on the dashboard this waits until the
  // video has been watched or skipped; it comes up right after.
  const onDashboard = pathname === "/dashboard";
  const { data: guide } = useGuideSeen(ready && onDashboard && !!visa?.required);
  const guideDone = !onDashboard || (!!guide && guide.guideSeenAt !== null);

  if (!ready || !visa?.required || !guideDone) return null;
  return <VisaPopup status={visa} />;
}

/** A slim line while HR checks what was sent — so nobody wonders whether it went. */
export function VisaPendingNotice() {
  const { data: session, status } = useSession();
  const { isKioskOnly } = useAuth();
  const ready = status === "authenticated" && !session?.impersonatedBy && !isKioskOnly;
  const { data: visa } = useMyVisa(ready);
  if (!ready || !visa?.pending) return null;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-2 text-sm text-sky-700 dark:text-sky-400">
      <Plane className="h-4 w-4 shrink-0" />
      <span>Your {visa.latest?.kind === "renewal" ? "visa renewal" : "visa"} is with HR for checking.</span>
    </div>
  );
}

/**
 * The visa form. Locked by default — the gate above. With `onClose` it is the
 * same form opened by choice, from the profile, to send a renewed visa before
 * the old one runs out: then it closes like any other dialog.
 */
export function VisaPopup({ status: s, onClose }: { status: MyVisaStatus; onClose?: () => void }) {
  const closable = !!onClose;
  const submit = useSubmitMyVisa();
  const canRenew = s.reason === "expired" || s.reason === "returned";
  const [kind, setKind] = useState<"visa" | "renewal">("visa");
  const [expiry, setExpiry] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ expiry?: string; file?: string }>({});
  const [showClock, setShowClock] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setErrors({}); }, [kind]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { setErrors((e) => ({ ...e, file: "That file is over 10 MB — take a smaller photo or scan" })); return; }
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) { setErrors((e) => ({ ...e, file: "Upload a PDF or a photo (JPG, PNG)" })); return; }
    setFile(f);
    setErrors((e) => ({ ...e, file: undefined }));
  };

  const send = () => {
    const next: typeof errors = {};
    if (kind === "visa") {
      if (!expiry) next.expiry = "Enter the expiry date shown on your visa";
      else if (expiry < tomorrow()) next.expiry = "That date has passed — enter your current visa's expiry";
    }
    if (!file) next.file = kind === "visa" ? "Upload a copy of your visa" : "Upload the renewal application or receipt";
    setErrors(next);
    if (Object.keys(next).length || !file) return;
    submit.mutate({ kind, expiryDate: kind === "visa" ? expiry : undefined, file }, { onSuccess: () => onClose?.() });
  };

  const block = (e: Event) => { if (!closable) e.preventDefault(); };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o && closable) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          aria-describedby="visa-gate-desc"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border bg-background p-5 shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Plane className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold">{closable ? "Send your renewed visa" : "Update your visa details"}</DialogPrimitive.Title>
              <DialogPrimitive.Description id="visa-gate-desc" className="text-sm text-muted-foreground">
                {closable ? "HR checks it before it replaces the one on file." : "HR needs your current visa on file. This stays open until you send it."}
              </DialogPrimitive.Description>
            </div>
            {closable && (
              <DialogPrimitive.Close className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            )}
          </div>

          {reasonText(s) && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{reasonText(s)}</span>
            </div>
          )}

          {canRenew && (
            <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="What you are sending">
              {([["visa", "I have my visa", "The new or current one"], ["renewal", "Renewal in progress", "Send the application or receipt"]] as const).map(([k, title, sub]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={cn("rounded-lg border px-3 py-2 text-left text-sm transition", kind === k ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50")}>
                  <div className="font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground">{sub}</div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-4">
            {kind === "visa" && (
              <div className="space-y-1.5">
                <Label htmlFor="visa-expiry">Visa expiry date <span className="text-destructive">*</span></Label>
                <Input id="visa-expiry" type="date" min={tomorrow()} value={expiry}
                  onChange={(e) => { setExpiry(e.target.value); setErrors((x) => ({ ...x, expiry: undefined })); }}
                  aria-invalid={!!errors.expiry} className={cn(errors.expiry && "border-destructive")} />
                {errors.expiry ? <p className="text-xs text-destructive">{errors.expiry}</p> : <p className="text-xs text-muted-foreground">As printed on the visa.</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{kind === "visa" ? "Visa copy" : "Renewal application or receipt"} <span className="text-destructive">*</span></Label>
              <input ref={input} type="file" accept={ACCEPT} className="hidden"
                onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              {file ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(file.size)}</span>
                  <button type="button" aria-label="Remove file" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setFile(null)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => input.current?.click()}
                  className={cn("flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground transition hover:bg-muted/40", errors.file && "border-destructive")}>
                  <Upload className="h-5 w-5" />
                  <span>{kind === "visa" ? "Upload a PDF or a clear photo of your visa" : "Upload the renewal application or receipt"}</span>
                  <span className="text-xs">PDF, JPG or PNG · up to 10 MB</span>
                </button>
              )}
              {errors.file && <p className="text-xs text-destructive">{errors.file}</p>}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">HR checks it before it counts.</span>
            <Button onClick={send} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {kind === "visa" ? "Send my visa" : "Send the receipt"}
            </Button>
          </div>

          {/* Clocking in never waits on paperwork. */}
          {!closable && <div className="mt-4 border-t pt-3">
            <button type="button" onClick={() => setShowClock((v) => !v)}
              className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground">
              <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />Need to clock in or out first?</span>
              {showClock ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showClock && <div className="mt-3"><ClockCard /></div>}
          </div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
