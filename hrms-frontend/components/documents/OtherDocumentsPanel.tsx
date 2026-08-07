"use client";
import { useState } from "react";
import {
  Plus, Pencil, Trash2, Loader2, ExternalLink, FileText, CalendarDays, FilePlus2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { OtherDocumentDialog } from "@/components/documents/OtherDocumentDialog";
import { useOtherDocuments, useDeleteOtherDocument } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";
import type { EmployeeOtherDocument } from "@/types";

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;

/** Whole days from today, negative once past. */
function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

interface Props {
  employeeId: string;
  canEdit: boolean;
  /** Renders inside an existing card rather than providing its own. */
  bare?: boolean;
}

/**
 * Documents and credentials the fixed fields don't cover.
 *
 * One list for both: an entry can carry an expiry, a file, or both, so a
 * residence permit is filed once and shows up as a scan and in the renewal
 * reminders. Anything with an expiry inside 90 days is flagged here and picked
 * up by the same dashboard alerting as passports and visas.
 */
export function OtherDocumentsPanel({ employeeId, canEdit, bare }: Props) {
  const { data: docs = [], isLoading } = useOtherDocuments(employeeId);
  const { mutate: remove, isPending: removing } = useDeleteOtherDocument(employeeId);
  const [editing, setEditing] = useState<EmployeeOtherDocument | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<EmployeeOtherDocument | null>(null);

  const body = (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FilePlus2 className="h-4 w-4 text-muted-foreground" />
            Other documents &amp; IDs
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Anything beyond passport, visa, labour card and Emirates ID — a licence, a contract, a
            second permit. Give one an expiry date and it joins the renewal reminders.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add</Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing filed here yet.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <Row
              key={d._id}
              doc={d}
              canEdit={canEdit}
              onEdit={() => setEditing(d)}
              onDelete={() => setConfirming(d)}
            />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <OtherDocumentDialog
          open
          onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(null); } }}
          employeeId={employeeId}
          doc={editing}
        />
      )}

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Remove document"
        description={`"${confirming?.label}" will be removed${confirming?.fileName ? ", along with the uploaded file" : ""}.`}
        isPending={removing}
        onConfirm={() => confirming && remove(confirming._id, { onSuccess: () => setConfirming(null) })}
      />
    </>
  );

  return bare ? <div>{body}</div> : <Card className="p-5">{body}</Card>;
}

function Row({
  doc, canEdit, onEdit, onDelete,
}: { doc: EmployeeOtherDocument; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const left = daysLeft(doc.expiryDate);
  const expired = left !== null && left < 0;
  const soon = left !== null && left >= 0 && left <= 90;

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl border p-3 transition-colors",
      expired ? "border-destructive/30 bg-destructive/5" : soon ? "border-amber-500/30 bg-amber-500/5" : "border-border"
    )}>
      <div className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        expired ? "bg-destructive/10 text-destructive" : soon ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"
      )}>
        <FileText className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-medium">{doc.label}</p>
          {doc.number && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{doc.number}</span>}
          {expired && <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">Expired</span>}
          {soon && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">{left}d left</span>}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {doc.issueDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />Issued {fmtDate(doc.issueDate)}</span>}
          {doc.expiryDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />Expires {fmtDate(doc.expiryDate)}</span>}
          {doc.fileUrl && (
            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {doc.fileName || "View file"}<ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {doc.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{doc.notes}</p>}
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label={`Edit ${doc.label}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete} aria-label={`Remove ${doc.label}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
