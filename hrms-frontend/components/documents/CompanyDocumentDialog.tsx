"use client";
import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddCompanyDocument, useUpdateCompanyDocument } from "@/hooks/useCompanyDocuments";
import { COMPANY_DOC_TYPE_LABELS, companyDocTypeLabel, type CompanyDocument } from "@/types";

const schema = z.object({
  companyName: z.string().min(1, "Which company is this for?").max(120),
  documentType: z.string().min(1, "Pick or type a document type").max(60),
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

/** Picked from the dropdown to type a kind nobody has filed before. */
const CUSTOM = "__custom__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent when adding. */
  doc?: CompanyDocument | null;
  /** Names already on file, offered so the same entity is spelled one way. */
  companies?: string[];
}

export function CompanyDocumentDialog({ open, onOpenChange, doc, companies = [] }: Props) {
  const isEditing = !!doc;
  const { mutate: add, isPending: adding } = useAddCompanyDocument();
  const { mutate: update, isPending: updating } = useUpdateCompanyDocument();
  const isPending = adding || updating;

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // Kept outside the form value so the box stays open while it is still empty.
  const [customType, setCustomType] = useState(false);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { companyName: "", documentType: "trade_licence", number: "", issueDate: "", expiryDate: "", notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setCustomType(false);
    reset({
      companyName: doc?.companyName ?? "",
      documentType: doc?.documentType ?? "trade_licence",
      number: doc?.number ?? "",
      issueDate: toDateInput(doc?.issueDate),
      expiryDate: toDateInput(doc?.expiryDate),
      notes: doc?.notes ?? "",
    });
  }, [open, doc, reset]);

  const onSubmit = (data: FormValues) => {
    const done = { onSuccess: () => onOpenChange(false) };
    if (isEditing) update({ id: doc._id, ...data, file }, done);
    else add({ ...data, file }, done);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit company document" : "Add a company document"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            Licences, contracts and permits the business holds. Add an expiry date and it will show up
            here as it comes due.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="companyName">Company *</Label>
            {/* A datalist rather than a picker: the list is a memory aid, and a
                new entity has to be typeable the first time it appears. */}
            <Input
              id="companyName" list="company-names" autoComplete="off"
              placeholder="e.g. Delta International Management Development Training"
              {...register("companyName")}
            />
            <datalist id="company-names">
              {companies.map((c) => <option key={c} value={c} />)}
            </datalist>
            {errors.companyName && <p className="text-xs text-destructive">{errors.companyName.message}</p>}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Document type *</Label>
            <Controller name="documentType" control={control} render={({ field }) => (
              customType ? (
                <Input
                  autoFocus placeholder="e.g. Fire safety certificate"
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={() => { if (!field.value.trim()) { field.onChange("other"); setCustomType(false); } }}
                />
              ) : (
                <Select
                  value={field.value}
                  onValueChange={(v) => { if (v === CUSTOM) { setCustomType(true); field.onChange(""); } else field.onChange(v); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* A type already on file that we have no label for still has
                        to be selectable, or editing silently reclassifies it. */}
                    {Array.from(new Set([...Object.keys(COMPANY_DOC_TYPE_LABELS), field.value].filter(Boolean))).map((k) => (
                      <SelectItem key={k} value={k}>{companyDocTypeLabel(k)}</SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>Something else…</SelectItem>
                  </SelectContent>
                </Select>
              )
            )} />
            {errors.documentType && <p className="text-xs text-destructive">{errors.documentType.message}</p>}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="number">Reference number</Label>
            <Input id="number" placeholder="Optional — licence or contract number" {...register("number")} />
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
