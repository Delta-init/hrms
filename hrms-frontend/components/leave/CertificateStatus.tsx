"use client";
import { useRef } from "react";
import { FileCheck2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadLeaveCertificate } from "@/hooks/useLeaves";
import { CERTIFIED_SICK, type LeaveRequest } from "@/types";

/** Whether a request can be approved yet — a certified sick one waits for its certificate. */
export const awaitingCertificate = (l: LeaveRequest) => l.type === CERTIFIED_SICK && l.status === "pending" && !l.certificate;

/**
 * Under a leave's type: for Certified Sick Leave, where the medical
 * certificate stands — due by when (with the upload button, on one's own),
 * or a link to it — and for a request that became unpaid, why.
 */
export function CertificateStatus({ leave: l, meId }: { leave: LeaveRequest; meId?: string }) {
  const { mutate: upload, isPending } = useUploadLeaveCertificate();
  const input = useRef<HTMLInputElement>(null);

  if (l.convertedFrom === CERTIFIED_SICK) {
    return (
      <span className="block text-[11px] text-amber-700 dark:text-amber-400">
        Was certified sick · {l.conversionReason === "no_certificate" ? "no certificate in time" : "not approved"}
      </span>
    );
  }
  if (l.type !== CERTIFIED_SICK) return null;

  if (l.certificateUrl) {
    return (
      <a href={l.certificateUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline dark:text-emerald-400">
        <FileCheck2 className="h-3 w-3" />Medical certificate
      </a>
    );
  }
  if (l.status !== "pending") return null;

  const due = l.certificateDueAt ? new Date(l.certificateDueAt) : null;
  const overdue = !!due && due.getTime() < Date.now();
  const mine = !!meId && (typeof l.user === "object" ? l.user?._id : l.user) === meId;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
      <span className={`text-[11px] ${overdue ? "text-red-600" : "text-amber-700 dark:text-amber-400"}`}>
        {overdue ? "Certificate overdue" : `Certificate due ${due ? due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`}
      </span>
      {mine && !overdue && (
        <>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload({ id: l._id, file });
              e.target.value = "";
            }} />
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" disabled={isPending}
            onClick={(e) => { e.stopPropagation(); input.current?.click(); }}>
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Upload certificate
          </Button>
        </>
      )}
    </span>
  );
}
