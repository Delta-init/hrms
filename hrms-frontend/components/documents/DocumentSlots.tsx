"use client";
import { useRef, useState } from "react";
import { Upload, Loader2, Trash2, ExternalLink, CheckCircle2, FileText, ImageIcon } from "lucide-react";
import { useUploadDocument, useDeleteDocument } from "@/hooks/useDocuments";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DocRequirement, DocumentType, EmployeeDocument } from "@/types";

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  passport: "Passport",
  visa_copy: "Visa copy",
  aadhaar: "Aadhaar",
  photo: "Photo",
  education_certificate: "Educational certificate",
  experience_certificate: "Experience certificate",
};

const ALL_DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocumentType[];

/**
 * Every slot to show for a set of requirements.
 *
 * The requirement matrix is location-driven, so it covers nothing when an
 * employee has no location yet, and never covers types outside that location's
 * list. HR still needs somewhere to file those, so the remaining types are
 * offered as optional slots rather than being unreachable.
 */
export function allSlots(requirements: DocRequirement[]): DocRequirement[] {
  const covered = new Set(requirements.flatMap((r) => r.accepts));
  return [
    ...requirements,
    ...ALL_DOC_TYPES.filter((t) => !covered.has(t)).map((t) => ({
      key: t,
      label: DOC_TYPE_LABELS[t],
      required: false,
      isPhoto: t === "photo",
      accepts: [t],
    })),
  ];
}

interface Props {
  slots: DocRequirement[];
  documents: EmployeeDocument[];
  /** Omit for the signed-in user's own documents. */
  employeeId?: string;
  /** Viewers without edit rights see the files but no upload or delete controls. */
  readOnly?: boolean;
}

export function DocumentSlots({ slots, documents, employeeId, readOnly }: Props) {
  return (
    <div className="space-y-3">
      {slots.map((r) => (
        <DocSlot
          key={r.key}
          requirement={r}
          current={documents.find((d) => r.accepts.includes(d.type))}
          employeeId={employeeId}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function DocSlot({
  requirement: r, current, employeeId, readOnly,
}: { requirement: DocRequirement; current?: EmployeeDocument; employeeId?: string; readOnly?: boolean }) {
  const { mutate: upload, isPending: uploading } = useUploadDocument(employeeId);
  const { mutate: remove, isPending: removing } = useDeleteDocument(employeeId);
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

        {/* For identity (Aadhaar/Passport) let the uploader choose which one. */}
        {multi && !current && !readOnly && (
          <Select value={chosenType} onValueChange={(v) => setChosenType(v as DocumentType)}>
            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {r.accepts.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {!readOnly && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
