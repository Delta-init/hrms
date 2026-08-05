"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm, Controller, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import {
  User, Landmark, GraduationCap, MapPin, Home, ShieldAlert, CheckCircle2,
  ChevronLeft, ChevronRight, Loader2, Sparkles, FileText,
} from "lucide-react";
import { useMyProfile, useCompleteProfile } from "@/hooks/useOnboarding";
import { onboardingSchema, STEP_FIELDS, type OnboardingValues } from "@/lib/validations/onboardingSchema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { BLOOD_GROUPS, GENDER_LABELS, MARITAL_LABELS, TITLE_LABELS, type Employee } from "@/types";
import { DocumentsStep } from "@/components/onboarding/DocumentsStep";

const SECTIONS = [
  { label: "Personal", icon: User },
  { label: "Bank", icon: Landmark },
  { label: "Education", icon: GraduationCap },
  { label: "Current address", icon: MapPin },
  { label: "Permanent address", icon: Home },
  { label: "Emergency", icon: ShieldAlert },
  { label: "Documents", icon: FileText },
  { label: "Review", icon: CheckCircle2 },
];

/** Index of the documents step (uploads happen outside react-hook-form). */
const DOC_STEP = 6;

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

export default function OnboardingPage() {
  const router = useRouter();
  const { update } = useSession();
  const { data, isLoading } = useMyProfile();

  // No linked employee → server already marked complete → straight to app.
  useEffect(() => {
    if (data && !data.employee) {
      update({ appUser: { profileCompleted: true } }).finally(() => router.replace("/dashboard"));
    }
  }, [data, update, router]);

  if (isLoading || !data || (data && !data.employee)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return <Wizard employee={data.employee!} />;
}

function Wizard({ employee: e }: { employee: Employee }) {
  const router = useRouter();
  const { update } = useSession();
  const { mutate: complete, isPending } = useCompleteProfile();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [docsReady, setDocsReady] = useState(false);
  // Guards against a second click of a double-click landing on the button
  // that renders in the same screen position for the *next* step — e.g.
  // Documents' "Next" and Review's "Finish" occupy the same spot, and
  // Finish is a plain type="submit" button wired to the form's onSubmit,
  // a completely different code path from next() below that a re-entrancy
  // guard on next() alone can't reach. So instead of unlocking the instant
  // `step` changes (which re-renders Finish already enabled), keep every
  // nav button disabled for a short cooldown after each transition — long
  // enough that a second click arriving milliseconds later hits a disabled
  // button instead of firing a real submit. A ref backs the same lock so a
  // synchronous re-entrant call to next() itself is also caught immediately,
  // without waiting on React's async state update.
  const navLockedRef = useRef(false);
  const [navLocked, setNavLocked] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { navLockedRef.current = false; setNavLocked(false); }, 400);
    return () => clearTimeout(t);
  }, [step]);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    mode: "onTouched",
    defaultValues: {
      title: (e.title as OnboardingValues["title"]) ?? undefined,
      name: e.name ?? "", gender: (e.gender as OnboardingValues["gender"]) ?? undefined,
      email: e.email ?? "", personalEmail: e.personalEmail ?? "", mobileNumber: e.mobileNumber ?? "",
      dob: toDateInput(e.dob), bloodGroup: e.bloodGroup ?? "", nationality: e.nationality ?? "",
      maritalStatus: (e.maritalStatus as OnboardingValues["maritalStatus"]) ?? undefined,
      oldCompanyExperience: e.oldCompanyExperience ?? "",
      bank: { bankAccountNumber: e.bank?.bankAccountNumber ?? "", ibanIfsc: e.bank?.ibanIfsc ?? "", bankName: e.bank?.bankName ?? "", nameInBank: e.bank?.nameInBank ?? "" },
      education: { qualification: e.education?.[0]?.qualification ?? "", from: e.education?.[0]?.from ?? "", to: e.education?.[0]?.to ?? "", institute: e.education?.[0]?.institute ?? "" },
      currentAddress: { address: e.currentAddress?.address ?? "", city: e.currentAddress?.city ?? "", state: e.currentAddress?.state ?? "", country: e.currentAddress?.country ?? "" },
      permanentAddress: { address: e.permanentAddress?.address ?? "", city: e.permanentAddress?.city ?? "", state: e.permanentAddress?.state ?? "", country: e.permanentAddress?.country ?? "" },
      emergencyContact: { name: e.emergencyContacts?.[0]?.name ?? "", relation: e.emergencyContacts?.[0]?.relation ?? "", address: e.emergencyContacts?.[0]?.address ?? "", city: e.emergencyContacts?.[0]?.city ?? "", state: e.emergencyContacts?.[0]?.state ?? "", country: e.emergencyContacts?.[0]?.country ?? "", phoneNumber: e.emergencyContacts?.[0]?.phoneNumber ?? "", email: e.emergencyContacts?.[0]?.email ?? "" },
    },
  });

  const isReview = step === SECTIONS.length - 1;
  const progress = Math.round((step / (SECTIONS.length - 1)) * 100);

  const go = (delta: number) => { setDir(delta); setStep((s) => Math.min(SECTIONS.length - 1, Math.max(0, s + delta))); };

  const next = async () => {
    if (navLockedRef.current) return;
    navLockedRef.current = true;
    setNavLocked(true);
    if (step === DOC_STEP) {
      if (!docsReady) { toast.error("Please upload all required documents"); navLockedRef.current = false; setNavLocked(false); return; }
      go(1);
      return;
    }
    const ok = await form.trigger(STEP_FIELDS[step] as never);
    if (!ok) { toast.error("Please complete the required fields"); navLockedRef.current = false; setNavLocked(false); return; }
    go(1);
  };

  const onSubmit = (values: OnboardingValues) => {
    complete(values, {
      onSuccess: async () => {
        toast.success("Welcome aboard! Your profile is complete.");
        await update({ appUser: { profileCompleted: true } });
        router.replace("/dashboard");
      },
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-muted/40 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome, {e.name.split(" ")[0]} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">Let&apos;s complete your profile — it only takes a minute.</p>
        </div>

        {/* Progress + chips */}
        <div className="mb-5">
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full bg-primary" animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {SECTIONS.map((s, i) => (
              <span key={s.label} className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                <s.icon className="h-3 w-3" />{s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Card */}
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
            {/* mode="popLayout" so the next step mounts immediately on click —
                "wait" held the incoming step off-DOM until the outgoing one's
                exit animation resolved, and that resolution can lag well past
                its nominal 250ms (e.g. a backgrounded/unfocused tab throttles
                rAF), leaving the wizard looking frozen on the old step for
                seconds at a time. popLayout still animates the old step out,
                just without blocking the new one on it. */}
            <AnimatePresence mode="popLayout" custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                initial={{ opacity: 0, x: dir * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -40 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <StepBody step={step} form={form} isReview={isReview} onDocsReady={setDocsReady} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Nav */}
          <div className="mt-4 flex items-center justify-between">
            <Button type="button" variant="outline" onClick={() => go(-1)} disabled={step === 0 || navLocked}>
              <ChevronLeft className="h-4 w-4" />Back
            </Button>
            {isReview ? (
              <Button type="submit" disabled={isPending || navLocked} className="min-w-[140px]">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Finish
              </Button>
            ) : (
              <Button type="button" onClick={next} disabled={navLocked}>Next<ChevronRight className="h-4 w-4" /></Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function StepBody({ step, form, isReview, onDocsReady }: { step: number; form: UseFormReturn<OnboardingValues>; isReview: boolean; onDocsReady: (ready: boolean) => void }) {
  const { register, control, formState: { errors }, getValues } = form;

  if (step === DOC_STEP) return <DocumentsStep onReadyChange={onDocsReady} />;
  const F = (label: string, name: string, err?: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input {...register(name as never)} {...props} />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
  const Sel = (label: string, name: string, options: { value: string; label: string }[], err?: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Controller name={name as never} control={control} render={({ field }) => (
        <Select value={(field.value as string) || ""} onValueChange={field.onChange}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      )} />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
  const e = errors as Record<string, { message?: string } & Record<string, { message?: string }>>;

  if (isReview) return <Review values={getValues()} />;

  const heading = ["Personal details", "Bank details", "Education", "Current address", "Permanent / home address", "Emergency contact"][step];
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">{heading}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {step === 0 && (<>
          {Sel("Title", "title", (Object.keys(TITLE_LABELS) as (keyof typeof TITLE_LABELS)[]).map((k) => ({ value: k, label: TITLE_LABELS[k] })), e.title?.message)}
          {F("Full name", "name", e.name?.message)}
          {Sel("Gender", "gender", (Object.keys(GENDER_LABELS) as (keyof typeof GENDER_LABELS)[]).map((k) => ({ value: k, label: GENDER_LABELS[k] })), e.gender?.message)}
          {Sel("Marital status", "maritalStatus", (Object.keys(MARITAL_LABELS) as (keyof typeof MARITAL_LABELS)[]).map((k) => ({ value: k, label: MARITAL_LABELS[k] })), e.maritalStatus?.message)}
          {F("Work email", "email", e.email?.message, { type: "email" })}
          {F("Personal email", "personalEmail", e.personalEmail?.message, { type: "email" })}
          {F("Mobile number", "mobileNumber", e.mobileNumber?.message)}
          {F("Date of birth", "dob", e.dob?.message, { type: "date" })}
          {Sel("Blood group", "bloodGroup", BLOOD_GROUPS.map((b) => ({ value: b, label: b })), e.bloodGroup?.message)}
          {F("Nationality", "nationality", e.nationality?.message)}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Previous company experience</Label>
            <Textarea rows={2} {...register("oldCompanyExperience")} />
            {e.oldCompanyExperience?.message && <p className="text-xs text-destructive">{e.oldCompanyExperience.message}</p>}
          </div>
        </>)}

        {step === 1 && (<>
          {F("Name in bank", "bank.nameInBank", e.bank?.nameInBank?.message)}
          {F("Bank name", "bank.bankName", e.bank?.bankName?.message)}
          {F("Account number", "bank.bankAccountNumber", e.bank?.bankAccountNumber?.message)}
          {F("IBAN / IFSC", "bank.ibanIfsc", e.bank?.ibanIfsc?.message)}
        </>)}

        {step === 2 && (<>
          <div className="sm:col-span-2">{F("Qualification", "education.qualification", e.education?.qualification?.message)}</div>
          {F("From (year)", "education.from", e.education?.from?.message, { placeholder: "2016" })}
          {F("To (year)", "education.to", e.education?.to?.message, { placeholder: "2020" })}
          <div className="sm:col-span-2">{F("Institute", "education.institute", e.education?.institute?.message)}</div>
        </>)}

        {step === 3 && (<>
          <div className="sm:col-span-2">{F("Address", "currentAddress.address", e.currentAddress?.address?.message)}</div>
          {F("City", "currentAddress.city", e.currentAddress?.city?.message)}
          {F("State", "currentAddress.state", e.currentAddress?.state?.message)}
          {F("Country", "currentAddress.country", e.currentAddress?.country?.message)}
        </>)}

        {step === 4 && (<>
          <div className="sm:col-span-2">{F("Address", "permanentAddress.address", e.permanentAddress?.address?.message)}</div>
          {F("City", "permanentAddress.city", e.permanentAddress?.city?.message)}
          {F("State", "permanentAddress.state", e.permanentAddress?.state?.message)}
          {F("Country", "permanentAddress.country", e.permanentAddress?.country?.message)}
        </>)}

        {step === 5 && (<>
          {F("Name", "emergencyContact.name", e.emergencyContact?.name?.message)}
          {F("Relation", "emergencyContact.relation", e.emergencyContact?.relation?.message)}
          {F("Phone number", "emergencyContact.phoneNumber", e.emergencyContact?.phoneNumber?.message)}
          {F("Email", "emergencyContact.email", e.emergencyContact?.email?.message, { type: "email" })}
          <div className="sm:col-span-2">{F("Address", "emergencyContact.address", e.emergencyContact?.address?.message)}</div>
          {F("City", "emergencyContact.city", e.emergencyContact?.city?.message)}
          {F("State", "emergencyContact.state", e.emergencyContact?.state?.message)}
          {F("Country", "emergencyContact.country", e.emergencyContact?.country?.message)}
        </>)}
      </div>
    </div>
  );
}

function Review({ values }: { values: OnboardingValues }) {
  const row = (k: string, v?: string) => (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v || "—"}</span>
    </div>
  );
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Review & finish</h2>
      <p className="mb-4 text-sm text-muted-foreground">Please confirm your details before submitting.</p>
      <div className="space-y-4">
        <ReviewGroup title="Personal">
          {row("Name", `${TITLE_LABELS[values.title]} ${values.name}`)}
          {row("Gender", GENDER_LABELS[values.gender])}
          {row("Marital status", MARITAL_LABELS[values.maritalStatus])}
          {row("Work email", values.email)}
          {row("Personal email", values.personalEmail)}
          {row("Mobile", values.mobileNumber)}
          {row("Date of birth", values.dob)}
          {row("Blood group", values.bloodGroup)}
          {row("Nationality", values.nationality)}
          {row("Previous experience", values.oldCompanyExperience)}
        </ReviewGroup>
        <ReviewGroup title="Bank">
          {row("Name in bank", values.bank.nameInBank)}
          {row("Bank name", values.bank.bankName)}
          {row("Account number", values.bank.bankAccountNumber)}
          {row("IBAN / IFSC", values.bank.ibanIfsc)}
        </ReviewGroup>
        <ReviewGroup title="Education">
          {row("Qualification", values.education.qualification)}
          {row("Period", `${values.education.from} – ${values.education.to}`)}
          {row("Institute", values.education.institute)}
        </ReviewGroup>
        <ReviewGroup title="Current address">
          {row("Address", [values.currentAddress.address, values.currentAddress.city, values.currentAddress.state, values.currentAddress.country].filter(Boolean).join(", "))}
        </ReviewGroup>
        <ReviewGroup title="Permanent address">
          {row("Address", [values.permanentAddress.address, values.permanentAddress.city, values.permanentAddress.state, values.permanentAddress.country].filter(Boolean).join(", "))}
        </ReviewGroup>
        <ReviewGroup title="Emergency contact">
          {row("Name", `${values.emergencyContact.name} (${values.emergencyContact.relation})`)}
          {row("Phone", values.emergencyContact.phoneNumber)}
          {row("Email", values.emergencyContact.email)}
          {row("Address", [values.emergencyContact.address, values.emergencyContact.city, values.emergencyContact.state, values.emergencyContact.country].filter(Boolean).join(", "))}
        </ReviewGroup>
      </div>
    </div>
  );
}

const ReviewGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border p-3">
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">{title}</p>
    {children}
  </div>
);
