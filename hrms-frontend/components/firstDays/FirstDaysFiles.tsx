"use client";
import { useRef } from "react";
import { FileText, Loader2, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOC_ACCEPT } from "@/components/firstDays/AddHomeworkDialog";

/** A stored file, opened in a new tab. */
export function FileLink({ file, label, video }: { file: { name: string; url: string }; label: string; video?: boolean }) {
  const Icon = video ? Video : FileText;
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-muted">
      <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}: {file.name}</span>
    </a>
  );
}

/** A button that opens a file picker and hands the chosen file on. */
export function UploadButton({ label, busy, onFile, accept = DOC_ACCEPT }: { label: string; busy: boolean; onFile: (f: File) => void; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" className="hidden" accept={accept}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{label}
      </Button>
    </>
  );
}
