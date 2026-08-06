"use client";
import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useMyDocuments } from "@/hooks/useDocuments";
import { DocumentSlots } from "@/components/documents/DocumentSlots";

export function DocumentsStep({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const { data, isLoading } = useMyDocuments();
  // Memoized so the fallback arrays don't retrigger the readiness effect every render.
  const requirements = useMemo(() => data?.requirements ?? [], [data?.requirements]);
  const documents = useMemo(() => data?.documents ?? [], [data?.documents]);

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
      {/* Onboarding shows only what this location asks for; HR's own view adds
          the remaining types as optional slots. */}
      <DocumentSlots slots={requirements} documents={documents} />
    </div>
  );
}
