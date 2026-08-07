"use client";
import { useRef } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { useUploadDocument, useDeleteDocument } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  photoUrl?: string | null;
  /** Omit to act on the signed-in user's own record (self-service). */
  employeeId?: string;
  /** Without this the picture is shown but not changeable. */
  canEdit?: boolean;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Profile picture with a change control laid over it.
 *
 * Writes through the `photo` document slot, which the document service already
 * mirrors onto `employee.photo` — so the picture, the onboarding photo
 * requirement and the avatar stay one thing rather than three. Passing no
 * `employeeId` targets the caller's own record, which is what lets people
 * change their own picture without any admin permission.
 */
export function AvatarUploader({
  name, photoUrl, employeeId, canEdit, className, fallbackClassName,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate: upload, isPending: uploading } = useUploadDocument(employeeId);
  const { mutate: remove, isPending: removing } = useDeleteDocument(employeeId);
  const busy = uploading || removing;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload({ type: "photo", file });
    e.target.value = "";
  };

  if (!canEdit) return <PersonAvatar name={name} photoUrl={photoUrl} className={className} fallbackClassName={fallbackClassName} />;

  return (
    <div className={cn("group relative shrink-0", className)}>
      <PersonAvatar name={name} photoUrl={photoUrl} className="h-full w-full" fallbackClassName={fallbackClassName} />

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={photoUrl ? "Change profile picture" : "Add a profile picture"}
        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-100"
      >
        {busy ? <Loader2 className="h-1/3 w-1/3 animate-spin" /> : <Camera className="h-1/3 w-1/3" />}
      </button>

      {photoUrl && !busy && (
        <button
          type="button"
          onClick={() => remove("photo")}
          aria-label="Remove profile picture"
          className="absolute -bottom-1 -right-1 rounded-full border border-border bg-card p-1 text-destructive opacity-0 shadow-sm transition hover:bg-destructive/10 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
