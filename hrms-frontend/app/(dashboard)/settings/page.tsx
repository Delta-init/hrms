"use client";
import { useRef, useState } from "react";
import { Settings, FileText, PlayCircle, Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useAgreementTemplates, useUploadTemplate, useUploadInductionVideo } from "@/hooks/useAgreements";
import { AGREEMENT_KIND_LABELS, type AgreementKind, type AgreementVariant } from "@/types";
import { cn } from "@/lib/utils";

const SLOTS: Array<{ kind: AgreementKind; variant: AgreementVariant }> = [
  { kind: "nda", variant: "onsite" }, { kind: "tc", variant: "onsite" },
  { kind: "nda", variant: "remote" }, { kind: "tc", variant: "remote" },
];

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("settings", "edit");
  const { data, isLoading } = useAgreementTemplates();
  const { mutate: uploadTemplate, isPending: uploadingDoc } = useUploadTemplate();
  const { mutate: uploadVideo, isPending: uploadingVideo } = useUploadInductionVideo();
  const [busy, setBusy] = useState<string | null>(null);

  if (!hasPermission("settings", "view")) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" description="Onboarding agreements and induction." icon={Settings} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to settings.</Card>
      </div>
    );
  }

  const found = (kind: AgreementKind, variant: AgreementVariant) =>
    data?.templates.find((t) => t.kind === kind && t.variant === variant);
  const ready = SLOTS.every((s) => found(s.kind, s.variant)) && !!data?.video;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="What every new joiner has to watch and sign." icon={Settings} />

      {isLoading ? (
        <Card className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : (
        <>
          <Card className={cn("flex items-start gap-3 p-4", ready ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
            {ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
            <div className="text-sm">
              <p className="font-medium">{ready ? "Ready to switch on" : "Not ready yet"}</p>
              <p className="mt-1 text-muted-foreground">
                {ready
                  ? "All four agreements and the induction video are in place. The gate, and whether it also asks for a face, are switched on from the Organizations page."
                  : "Upload all four agreements and the induction video before switching the gate on — turning it on first would lock everyone out."}
              </p>
              {!!data?.unclassified && (
                <p className="mt-2 text-muted-foreground">
                  <strong className="font-medium text-foreground">{data.unclassified}</strong>{" "}
                  {data.unclassified === 1 ? "employee has" : "employees have"} no work mode set, so we cannot tell
                  which agreements apply to them. They are blocked from signing until someone marks them Office or
                  Work from home.
                </p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Agreements</h3>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Onsite and remote staff sign different documents. Uploading a replacement supersedes the previous
              version — anything already signed keeps pointing at the wording it was signed against.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SLOTS.map((slot) => {
                const t = found(slot.kind, slot.variant);
                const id = `${slot.variant}-${slot.kind}`;
                return (
                  <div key={id} className="rounded-xl border border-border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{slot.variant}</p>
                    <p className="mt-0.5 text-sm font-medium">{AGREEMENT_KIND_LABELS[slot.kind]}</p>
                    {t ? (
                      <a href={t.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-primary hover:underline">
                        v{t.version} · {t.fileName || "document.pdf"}
                      </a>
                    ) : (
                      <p className="mt-1 text-xs text-amber-600">Not uploaded</p>
                    )}
                    {canEdit && (
                      <FilePicker
                        accept="application/pdf" label={t ? "Replace" : "Upload"} id={id}
                        busy={busy === id && uploadingDoc}
                        onPick={(file) => { setBusy(id); uploadTemplate({ file, kind: slot.kind, variant: slot.variant }); }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Induction video</h3>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              MP4 only. Its length is measured from the file when you upload it, and that is the number every
              completion check is compared against — which is why we don&apos;t take it from the browser.
            </p>
            {data?.video ? (
              <div className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium">{data.video.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {Math.floor(data.video.durationSeconds / 60)}m {data.video.durationSeconds % 60}s
                </p>
              </div>
            ) : (
              <p className="text-xs text-amber-600">No video uploaded.</p>
            )}
            {canEdit && (
              <FilePicker
                accept="video/mp4" label={data?.video ? "Replace video" : "Upload video"} id="video"
                busy={uploadingVideo} onPick={(file) => uploadVideo(file)}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function FilePicker({ accept, label, id, busy, onPick }: {
  accept: string; label: string; id: string; busy: boolean; onPick: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <input
        ref={ref} id={id} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
      <Button variant="outline" size="sm" className="mt-3 w-full gap-1.5" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {label}
      </Button>
    </>
  );
}
