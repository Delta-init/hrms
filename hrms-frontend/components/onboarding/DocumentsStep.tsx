"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, Trash2, ExternalLink, CheckCircle2, FileText, ImageIcon } from "lucide-react";
import { useMyDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/useDocuments";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DocRequirement, DocumentType, EmployeeDocument } from "@/types";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  passport: "Passport",
  visa_copy: "Visa copy",
  aadhaar: "Aadhaar",
  photo: "Photo",
  education_certificate: "Educational certificate",
  experience_certificate: "Experience certificate",
};

export function DocumentsStep({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const { data, isLoading } = useMyDocuments();
  const requirements = data?.requirements ?? [];
  const documents = data?.documents ?? [];

  // Report readiness whenever docs/requirements change (backend enforces too).
  useEffect(() => {
    const ready = requirements
      .filter((r) => r.required)
      .every((r) => documents.some((d) => r.accepts.includes(d.type)));
    onReadyChange(ready);
  }, [requirements, documents, onReadyChange]);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data?.location) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Documents</h2>
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Your work location hasn&apos;t been set yet, so no documents are required.
          You can continue — HR will request documents if needed.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Documents</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Upload the documents required for <span className="font-medium capitalize">{data.location}</span>.
        Accepted: JPG, PNG, WEBP or PDF (max 10MB).
      </p>
      <div className="space-y-3">
        {requirements.map((r) => (
          <DocSlot
            key={r.key}
            requirement={r}
            current={documents.find((d) => r.accepts.includes(d.type))}
          />
        ))}
      </div>
    </div>
  );
}

function DocSlot({ requirement: r, current }: { requirement: DocRequirement; current?: EmployeeDocument }) {
  const { mutate: upload, isPending: uploading } = useUploadDocument();
  const { mutate: remove, isPending: removing } = useDeleteDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosenType, setChosenType] = useState<DocumentType>(r.accepts[0]);
  const multi = r.accepts.length > 1;
  const accept = r.isPhoto ? "image/*" : "image/*,application/pdf";

  const pick = () => inputRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload({ type: current?.type ?? chosenType, file });
    e.target.value = "";
  };

  return (
    <div className={cn(
      "rounded-xl border p-3 transition-colors",
      current ? "border-emerald-500/30 bg-emerald-500/5" : r.required ? "border-border" : "border-dashed border-border"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          current ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
        )}>
          {current ? <CheckCircle2 className="h-5 w-5" /> : r.isPhoto ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{r.label}</p>
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              r.required ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
            )}>{r.required ? "Required" : "Optional"}</span>
          </div>
          {current ? (
            <a href={current.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 truncate text-xs text-primary hover:underline">
              {current.fileName || DOC_TYPE_LABELS[current.type]} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">Not uploaded yet</p>
          )}
        </div>

        {/* For identity (Aadhaar/Passport) let the user choose which one to upload. */}
        {multi && !current && (
          <Select value={chosenType} onValueChange={(v) => setChosenType(v as DocumentType)}>
            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {r.accepts.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onFile} />
        {current ? (
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="sm" onClick={pick} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Replace"}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => remove(current.type)} disabled={removing}>
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" onClick={pick} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4" />Upload</>}
          </Button>
        )}
      </div>
    </div>
  );
}
