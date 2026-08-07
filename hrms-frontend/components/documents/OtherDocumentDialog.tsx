"use client";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload, ExternalLink, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAddOtherDocument, useUpdateOtherDocument } from "@/hooks/useDocuments";
import type { EmployeeOtherDocument } from "@/types";

const schema = z.object({
  label: z.string().min(1, "Give this document a name").max(120),
  number: z.string().max(60).optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  notes: z.string().max(500).optional(),
}).refine((v) => !v.issueDate || !v.expiryDate || v.expiryDate >= v.issueDate, {
  path: ["expiryDate"],
  message: "Expiry can't be before the issue date",
});
type FormValues = z.infer<typeof schema>;

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  /** Absent when adding. */
  doc?: EmployeeOtherDocument | null;
}

export function OtherDocumentDialog({ open, onOpenChange, employeeId, doc }: Props) {
  const isEditing = !!doc;
  const { mutate: add, isPending: adding } = useAddOtherDocument(employeeId);
  const { mutate: update, isPending: updating } = useUpdateOtherDocument(employeeId);
  const isPending = adding || updating;

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: "", number: "", issueDate: "", expiryDate: "", notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    setFile(null);
    reset({
      label: doc?.label ?? "",
      number: doc?.number ?? "",
      issueDate: toDateInput(doc?.issueDate),
      expiryDate: toDateInput(doc?.expiryDate),
      notes: doc?.notes ?? "",
    });
  }, [open, doc, reset]);

  const onSubmit = (data: FormValues) => {
    const payload = { ...data, file };
    const done = { onSuccess: () => onOpenChange(false) };
    if (isEditing) update({ recordId: doc._id, ...payload }, done);
    else add(payload, done);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit document" : "Add a document"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            Only the name is required. Add an expiry date and it will appear in the renewal reminders.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="label">Name *</Label>
            <Input id="label" placeholder="e.g. Driving licence, Signed contract" {...register("label")} />
            {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="number">Reference number</Label>
            <Input id="number" placeholder="Optional" {...register("number")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issueDate">Issue date</Label>
            <Input id="issueDate" type="date" {...register("issueDate")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiryDate">Expiry date</Label>
            <Input id="expiryDate" type="date" {...register("expiryDate")} />
            {errors.expiryDate && <p className="text-xs text-destructive">{errors.expiryDate.message}</p>}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Attached file</Label>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
            />
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2.5">
              {file ? (
                <>
                  <span className="truncate text-sm">{file.name}</span>
                  <Button type="button" variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={() => setFile(null)} aria-label="Clear the chosen file">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : doc?.fileUrl ? (
                <>
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 truncate text-sm text-primary hover:underline">
                    {doc.fileName || "Current file"}<ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => inputRef.current?.click()}>Replace</Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">No file attached</span>
                  <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => inputRef.current?.click()}>
                    <Upload className="h-4 w-4" />Attach
                  </Button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or PDF, up to 10MB.</p>
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : "Add document"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
