"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCandidate } from "@/hooks/useCandidates";

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

export function CandidateDialog({ open, onOpenChange, onSaved }: Props) {
  const { mutate: create, isPending } = useCreateCandidate();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({ defaultValues: EMPTY });

  useEffect(() => { if (open) reset(EMPTY); }, [open, reset]);

  const onSubmit = (d: FormValues) => {
    create(
      {
        ...d,
        totalExperienceYears: num(d.totalExperienceYears),
        noticePeriodDays: num(d.noticePeriodDays),
        expectedSalary: num(d.expectedSalary),
        links: [],
      } as never,
      { onSuccess: ({ record }) => { onSaved?.(record._id); onOpenChange(false); } }
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
              <Input id="source" placeholder="Referral, agency, LinkedIn…" {...register("source")} />
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

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save candidate
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
