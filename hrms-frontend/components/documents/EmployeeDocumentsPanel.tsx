"use client";
import { useMemo } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { useDocuments } from "@/hooks/useDocuments";
import { DocumentSlots, allSlots } from "@/components/documents/DocumentSlots";
import { Card } from "@/components/ui/card";

interface Props {
  employeeId: string;
  /** Uploading and removing need employees.edit; viewing only needs employees.view. */
  canEdit: boolean;
}

/**
 * An employee's document file, managed by HR.
 *
 * The required slots come from the employee's work location; everything else is
 * offered as optional, so a passport can still be filed for someone whose
 * location hasn't been set.
 */
export function EmployeeDocumentsPanel({ employeeId, canEdit }: Props) {
  const { data, isLoading } = useDocuments(employeeId);
  const slots = useMemo(() => allSlots(data?.requirements ?? []), [data?.requirements]);
  const documents = data?.documents ?? [];

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const uploaded = documents.length;
  const missing = slots.filter((s) => s.required && !s.accepts.some((t) => documents.some((d) => d.type === t)));

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            Documents
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data?.location
              ? <>Required documents for <span className="font-medium capitalize">{data.location}</span>. </>
              : <>No work location set, so nothing is mandatory yet. </>}
            {canEdit ? "JPG, PNG, WEBP or PDF, up to 10MB each." : "You can view these but not change them."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{uploaded} on file</span>
          {missing.length > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-1 font-medium text-destructive">
              {missing.length} required missing
            </span>
          )}
        </div>
      </div>

      <DocumentSlots slots={slots} documents={documents} employeeId={employeeId} readOnly={!canEdit} />
    </Card>
  );
}
