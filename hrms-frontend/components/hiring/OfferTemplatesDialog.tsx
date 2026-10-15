"use client";
import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useOfferTemplates, useSaveOfferTemplate, useDeleteOfferTemplate } from "@/hooks/useOffers";
import type { OfferEmailTemplate } from "@/types";

/** What can go in {{ }} — the same words work in the offer letter. */
const TOKENS = [
  "candidate.name", "offer.position", "offer.department", "offer.salary", "offer.joiningDate",
  "offer.location", "offer.employmentType", "organization.name", "date.today",
];

const BLANK = { name: "", subject: "", body: "" };

/** The emails offers go out in. The letter itself is a Letters template. */
export function OfferTemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: templates = [], isLoading } = useOfferTemplates(open);
  const { mutate: save, isPending: saving } = useSaveOfferTemplate();
  const { mutate: remove, isPending: removing } = useDeleteOfferTemplate();
  const [deleting, setDeleting] = useState<OfferEmailTemplate | null>(null);
  const [editing, setEditing] = useState<OfferEmailTemplate | "new" | null>(null);
  const [form, setForm] = useState(BLANK);

  const start = (t: OfferEmailTemplate | "new") => {
    setEditing(t);
    setForm(t === "new"
      ? { name: "Standard offer", subject: "Your offer from {{organization.name}}", body: "Dear {{candidate.name}},\n\nWe are delighted to offer you the position of {{offer.position}} at {{organization.name}}. Your offer letter is attached.\n\nPlease sign the letter and reply to this email with the signed copy attached.\n\nKind regards,\nHR Team\n{{organization.name}}" }
      : { name: t.name, subject: t.subject, body: t.body });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEditing(null); }}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? (editing === "new" ? "New offer email" : `Edit — ${editing.name}`) : "Offer email templates"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {editing ? (
          <>
            <div className="space-y-3 px-4 sm:px-0">
              <div className="space-y-1.5">
                <Label htmlFor="ot-name">Name</Label>
                <Input id="ot-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ot-subject">Subject</Label>
                <Input id="ot-subject" value={form.subject} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ot-body">Email</Label>
                <Textarea id="ot-body" rows={10} value={form.body} maxLength={10000} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Fills in: {TOKENS.map((t) => <code key={t} className="mr-1 rounded bg-muted px-1">{`{{${t}}}`}</code>)}
              </p>
            </div>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Back</Button>
              <Button disabled={saving || !form.name.trim() || !form.subject.trim() || !form.body.trim()}
                onClick={() => save({ ...(editing === "new" ? {} : { id: editing._id }), ...form }, { onSuccess: () => setEditing(null) })}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <div className="space-y-2 px-4 pb-4 sm:px-0">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : templates.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No templates yet.</p>
            ) : (
              templates.map((t) => (
                <div key={t._id} className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.subject}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => start(t)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleting(t)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))
            )}
            <Button variant="outline" className="w-full" onClick={() => start("new")}><Plus className="h-4 w-4" />New template</Button>
            <p className="text-[11px] text-muted-foreground">The letter attached to the email comes from Letters — a template with the category “Offer”.</p>
          </div>
        )}
      </ResponsiveDialogContent>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete template"
        description={`"${deleting?.name ?? ""}" will be removed. Offers already sent are not affected.`}
        isPending={removing}
        onConfirm={() => deleting && remove(deleting._id, { onSuccess: () => setDeleting(null) })}
      />
    </ResponsiveDialog>
  );
}
