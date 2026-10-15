"use client";
import { useEffect, useState } from "react";
import { Loader2, Mail, Paperclip, Settings2, AlertTriangle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOfferTemplates, useOfferLetterTemplates, useOfferInbox, usePreviewOffer, useSendOffer } from "@/hooks/useOffers";
import type { Application, Candidate } from "@/types";

const NONE = "__none__";
const asCandidate = (c: Application["candidate"]) => (typeof c === "object" ? (c as Candidate) : null);
const shortDate = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: Application;
  onManageTemplates: () => void;
}

/**
 * Sending an offer: pick the email and the letter, read them filled in, change
 * anything, send. The letter goes as a PDF; replies come back to the hiring
 * team's thread for this candidate.
 */
export function SendOfferDialog({ open, onOpenChange, application, onManageTemplates }: Props) {
  const { data: emailTemplates = [] } = useOfferTemplates(open);
  const { data: letterTemplates = [] } = useOfferLetterTemplates(open);
  const { data: inbox } = useOfferInbox(open);
  const preview = usePreviewOffer();
  const { mutate: send, isPending: sending } = useSendOffer();

  const [emailTemplate, setEmailTemplate] = useState(NONE);
  const [letterTemplate, setLetterTemplate] = useState(NONE);
  const [joiningDate, setJoiningDate] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [letterSubject, setLetterSubject] = useState("");
  const [letterBody, setLetterBody] = useState("");

  const active = emailTemplates.filter((t) => t.status === "active");

  // Start from the first of each, once they have loaded.
  useEffect(() => {
    if (!open) return;
    if (emailTemplate === NONE && active[0]) setEmailTemplate(active[0]._id);
    if (letterTemplate === NONE && letterTemplates[0]) setLetterTemplate(letterTemplates[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active.length, letterTemplates.length]);

  // Choosing a template (or the joining date) fills the words in again.
  const { mutate: fill } = preview;
  useEffect(() => {
    if (!open) return;
    fill(
      { id: application._id, emailTemplate: emailTemplate === NONE ? null : emailTemplate, letterTemplate: letterTemplate === NONE ? null : letterTemplate, joiningDate: joiningDate || null },
      {
        onSuccess: (p) => {
          setSubject(p.subject);
          setBody(p.body);
          setLetterSubject(p.letterSubject);
          setLetterBody(p.letterBody);
        },
      }
    );
  }, [open, application._id, emailTemplate, letterTemplate, joiningDate, fill]);

  const candidate = asCandidate(application.candidate);
  const ready = !!subject.trim() && !!body.trim();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Send offer — {candidate?.name ?? "candidate"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          {application.offer?.sentAt && (
            <p className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-400">
              An offer already went on {shortDate(application.offer.sentAt)}. Sending again adds a new email to the thread.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Email template</Label>
                <button type="button" onClick={onManageTemplates} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  <Settings2 className="h-3 w-3" />Manage
                </button>
              </div>
              <Select value={emailTemplate} onValueChange={setEmailTemplate}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Write it myself</SelectItem>
                  {active.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Offer letter</Label>
              <Select value={letterTemplate} onValueChange={setLetterTemplate}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No letter</SelectItem>
                  {letterTemplates.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="of-join">Joining date</Label>
              <Input id="of-join" type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
            </div>
          </div>
          {letterTemplates.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No Offer letter templates yet — add one in Letters with the category “Offer”.</p>
          )}

          <div className="space-y-1.5">
            <Label>To</Label>
            <Input value={candidate?.email ?? ""} readOnly className="bg-muted/40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="of-subject">Subject</Label>
            <Input id="of-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="of-body">Email</Label>
            <Textarea id="of-body" rows={7} value={body} maxLength={10000} onChange={(e) => setBody(e.target.value)}
              placeholder="Write to them — ask them to sign the attached letter and reply with it." />
          </div>

          {letterTemplate !== NONE && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium"><Paperclip className="h-3.5 w-3.5" />Offer letter — attached as a PDF</p>
              <Input value={letterSubject} maxLength={200} onChange={(e) => setLetterSubject(e.target.value)} placeholder="Letter heading" />
              <Textarea rows={10} value={letterBody} maxLength={20000} onChange={(e) => setLetterBody(e.target.value)} className="font-mono text-xs" />
            </div>
          )}

          {inbox?.lastError ? (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Replies aren&rsquo;t being read from {inbox.mailbox ?? "the HR mailbox"} right now ({inbox.lastError}). The offer still sends, and a signed copy can be uploaded by hand.
            </p>
          ) : inbox?.mailbox ? (
            <p className="text-[11px] text-muted-foreground">Replies go to {inbox.mailbox} and appear in this candidate&rsquo;s offer emails within a few minutes.</p>
          ) : null}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready || sending || preview.isPending}
            onClick={() => send({ id: application._id, subject, body, letterSubject, letterBody: letterTemplate === NONE ? "" : letterBody }, { onSuccess: () => onOpenChange(false) })}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Send offer
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
