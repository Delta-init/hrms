"use client";
import { useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, FileSignature, Loader2, Paperclip, Upload, UserPlus } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useOfferThread, useUploadSignedOffer, useOfferInbox } from "@/hooks/useOffers";
import { cn } from "@/lib/utils";
import type { Application, Candidate, OfferMail } from "@/types";

const asCandidate = (c: Application["candidate"]) => (typeof c === "object" ? (c as Candidate) : null);
const when = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const size = (n?: number) => (!n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: Application;
  canEdit: boolean;
  /** Move them to Accepted and open Hire — offered once the signed copy is back. */
  onAcceptAndHire?: (app: Application) => void;
}

/**
 * Everything said about one offer: what went, what came back, and the signed
 * copy. A copy that arrived some other way can be uploaded here.
 */
export function OfferMailsDialog({ open, onOpenChange, application, canEdit, onAcceptAndHire }: Props) {
  const { data, isLoading } = useOfferThread(open ? application._id : undefined);
  const { data: inbox } = useOfferInbox(open);
  const { mutate: upload, isPending: uploading } = useUploadSignedOffer();
  const fileRef = useRef<HTMLInputElement>(null);
  const candidate = asCandidate(application.candidate);
  const offer = data?.offer ?? application.offer ?? null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Offer emails — {candidate?.name ?? "candidate"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 pb-4 sm:px-0">
          {offer?.signedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-sm">
                <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />Signed offer received
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {when(offer.signedAt)} · {offer.signedSource === "upload" ? "uploaded by HR" : "by email"}
                  {offer.signedUrl && (<> · <a href={offer.signedUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{offer.signedFileName ?? "Open"}</a></>)}
                </p>
              </div>
              {canEdit && application.stage === "offer" && application.status === "active" && onAcceptAndHire && (
                <Button size="sm" onClick={() => onAcceptAndHire(application)}><UserPlus className="h-3.5 w-3.5" />Accept &amp; create employee</Button>
              )}
            </div>
          ) : offer?.sentAt ? (
            <p className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-700 dark:text-sky-400">
              Offer sent {when(offer.sentAt)}{(offer.sentCount ?? 1) > 1 ? ` (${offer.sentCount} times)` : ""}. Waiting for the signed copy.
            </p>
          ) : null}

          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !data?.mails.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No offer emails yet.</p>
          ) : (
            <div className="space-y-2">
              {data.mails.map((m) => <MailRow key={m._id} mail={m} />)}
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground">
                {inbox?.lastError
                  ? `Replies aren't being read right now (${inbox.lastError}).`
                  : inbox?.mailbox ? `Replies to ${inbox.mailbox} show here within a few minutes.` : ""}
                {" "}Got the signed copy another way? Upload it.
              </p>
              <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload({ id: application._id, file });
                  e.target.value = "";
                }} />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}Upload signed offer
              </Button>
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function MailRow({ mail }: { mail: OfferMail }) {
  const [full, setFull] = useState(false);
  const out = mail.direction === "out";
  const upload = mail.source === "upload";
  const text = mail.text ?? "";
  const long = text.length > 280;
  return (
    <div className={cn("rounded-xl border p-3 text-sm", out ? "border-border bg-card" : "border-primary/20 bg-primary/5")}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {upload ? <FileSignature className="h-3.5 w-3.5 text-emerald-600" /> : out ? <ArrowUpRight className="h-3.5 w-3.5 text-sky-600" /> : <ArrowDownLeft className="h-3.5 w-3.5 text-primary" />}
          {upload ? `Uploaded by ${nameOf(mail.sentBy) || "HR"}` : out ? `Sent by ${nameOf(mail.sentBy) || "HR"} to ${(mail.to ?? []).join(", ")}` : `From ${mail.from}`}
        </span>
        <span className="text-muted-foreground">{when(mail.at)}</span>
      </div>
      {mail.subject && !upload && <p className="mt-1 font-medium">{mail.subject}</p>}
      {text && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
          {full || !long ? text : `${text.slice(0, 280)}…`}
          {long && (
            <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setFull((v) => !v)}>
              {full ? "Less" : "More"}
            </button>
          )}
        </p>
      )}
      {mail.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {mail.attachments.map((a) => (
            <a key={a.key} href={a.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs hover:border-primary/40 hover:text-primary">
              <Paperclip className="h-3 w-3" />{a.fileName}{a.size ? <span className="text-muted-foreground">· {size(a.size)}</span> : null}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
