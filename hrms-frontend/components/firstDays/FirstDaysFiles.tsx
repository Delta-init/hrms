"use client";
import { useRef } from "react";
import { FileText, Loader2, Upload, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*";
/** The server's limit for one document. */
export const MAX_DOC_MB = 10;

/** How many files one homework (or one side of it) can hold — the server's cap. */
export const MAX_FILES = 10;

/** A stored file, opened in a new tab — with a remove button when `onRemove` is given. */
export function FileLink({ file, label, video, onRemove, removing }: {
  file: { name: string; url: string }; label?: string; video?: boolean; onRemove?: () => void; removing?: boolean;
}) {
  const Icon = video ? Video : FileText;
  return (
    <span className="inline-flex max-w-full items-center rounded-lg border border-border text-xs">
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 px-3 py-1.5 text-primary hover:bg-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label ? `${label}: ` : ""}{file.name}</span>
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={removing} aria-label={`Remove ${file.name}`}
          className={cn("border-l border-border px-1.5 py-1.5 text-muted-foreground hover:text-destructive", removing && "opacity-50")}>
          {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </span>
  );
}

/** A button that opens a file picker — several files when `multiple` — and hands them on. */
export function UploadButton({ label, busy, onFiles, accept = DOC_ACCEPT, multiple = false, variant = "outline" }: {
  label: string; busy: boolean; onFiles: (f: File[]) => void; accept?: string; multiple?: boolean; variant?: "outline" | "default";
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" className="hidden" accept={accept} multiple={multiple}
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) onFiles(fs); }} />
      <Button size="sm" variant={variant} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{label}
      </Button>
    </>
  );
}

/** Files chosen in a form but not yet sent, each removable. */
export function PickedFiles({ files, onRemove, disabled }: { files: File[]; onRemove: (i: number) => void; disabled?: boolean }) {
  if (!files.length) return null;
  return (
    <ul className="space-y-1">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {f.type.startsWith("video/") ? <Video className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{(f.size / 1024 / 1024).toFixed(f.size < 10 * 1024 * 1024 ? 1 : 0)} MB</span>
          </span>
          <button type="button" onClick={() => onRemove(i)} disabled={disabled} aria-label={`Remove ${f.name}`}
            className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
        </li>
      ))}
    </ul>
  );
}
