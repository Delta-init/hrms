"use client";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { FileText, Loader2, Upload, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateCandidate, useUploadResume } from "@/hooks/useCandidates";
import { useAdPlatformNames } from "@/hooks/useAdSpend";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved candidate, so a caller can put them straight into a pipeline. */
  onSaved?: (id: string) => void;
}

interface FormValues {
  name: string; email: string; phone: string; source: string;
  currentCompany: string; currentDesignation: string;
  totalExperienceYears: string; noticePeriodDays: string;
  expectedSalary: string; currency: string; location: string; notes: string;
}

const EMPTY: FormValues = {
  name: "", email: "", phone: "", source: "", currentCompany: "", currentDesignation: "",
  totalExperienceYears: "", noticePeriodDays: "", expectedSalary: "", currency: "AED", location: "", notes: "",
};

const num = (v: string) => (v === "" ? undefined : Number(v));

/** Where candidates come from besides the paid ad platforms. */
const OTHER_SOURCES = ["Referral", "Agency", "Walk-in", "Careers page"];
const TYPED = "__typed";

export function CandidateDialog({ open, onOpenChange, onSaved }: Props) {
  const { mutate: create, isPending } = useCreateCandidate();
  const { mutateAsync: uploadCv, isPending: uploading } = useUploadResume();
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({ defaultValues: EMPTY });
  // A list rather than free text, so a candidate's source is the same word the
  // ad spend tracker uses for that platform — that is what lets it work out a
  // cost per candidate. "Other" still takes anything.
  const { data: platformNames = [] } = useAdPlatformNames(open);
  const [sourceChoice, setSourceChoice] = useState("");

  // The CV rides along with the form but is sent separately: the upload needs
  // an id to attach to, which does not exist until the candidate is saved.
  const [cv, setCv] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { reset(EMPTY); setCv(null); setSourceChoice(""); } }, [open, reset]);

  const onSubmit = (d: FormValues) => {
    create(
      {
        ...d,
        totalExperienceYears: num(d.totalExperienceYears),
        noticePeriodDays: num(d.noticePeriodDays),
        expectedSalary: num(d.expectedSalary),
        links: [],
      } as never,
      {
        onSuccess: async ({ record }) => {
          // A CV that will not upload must not cost us the candidate — they are
          // saved either way, and the hook has already said what went wrong.
          if (cv) await uploadCv({ id: record._id, file: cv }).catch(() => {});
          onSaved?.(record._id);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add a candidate</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" {...register("name", { required: true })} />
              {errors.name && <p className="text-xs text-destructive">A name is required</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" {...register("email", { required: true })} />
              {/* The email is what makes a re-application recognisable as the
                  same person, so it is the one field that cannot be skipped. */}
              <p className="text-[11px] text-muted-foreground">If this email is already on file, that record is updated.</p>
              {errors.email && <p className="text-xs text-destructive">An email is required</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source">Source</Label>
              <Select
                value={sourceChoice}
                onValueChange={(v) => { setSourceChoice(v); setValue("source", v === TYPED ? "" : v); }}
              >
                <SelectTrigger id="source"><SelectValue placeholder="Where they came from" /></SelectTrigger>
                <SelectContent>
                  {platformNames.map((p) => <SelectItem key={`ad-${p}`} value={p}>{p}</SelectItem>)}
                  {platformNames.length > 0 && <SelectSeparator />}
                  {OTHER_SOURCES.filter((o) => !platformNames.includes(o)).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  <SelectItem value={TYPED}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {sourceChoice === TYPED && <Input placeholder="Where they came from" maxLength={60} {...register("source")} />}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" {...register("location")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="currentCompany">Current company</Label>
              <Input id="currentCompany" {...register("currentCompany")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currentDesignation">Current title</Label>
              <Input id="currentDesignation" {...register("currentDesignation")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="totalExperienceYears">Experience (yrs)</Label>
              <Input id="totalExperienceYears" type="number" min={0} step="0.5" {...register("totalExperienceYears")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noticePeriodDays">Notice (days)</Label>
              <Input id="noticePeriodDays" type="number" min={0} {...register("noticePeriodDays")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" className="uppercase" {...register("currency")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expectedSalary">Expecting</Label>
              <Input id="expectedSalary" type="number" min={0} {...register("expectedSalary")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </div>

          <div className="space-y-1.5">
            <Label>CV</Label>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
              onChange={(e) => { setCv(e.target.files?.[0] ?? null); e.target.value = ""; }}
            />
            {cv ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{cv.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(cv.size / 1024)} KB</span>
                <button
                  type="button"
                  onClick={() => setCv(null)}
                  aria-label="Remove the CV"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full justify-start font-normal text-muted-foreground"
                onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" />Attach a CV
              </Button>
            )}
            {/* The same 10 MB ceiling every document goes through. */}
            <p className="text-[11px] text-muted-foreground">PDF or an image, up to 10 MB. Optional — it can be added later.</p>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || uploading}>
              {(isPending || uploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {uploading ? "Attaching CV…" : "Save candidate"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
