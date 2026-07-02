"use client";
import { useEffect, useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "approved" | "rejected";
  subject?: string;
  isPending?: boolean;
  onConfirm: (note: string) => void;
}

export function ReviewDialog({ open, onOpenChange, action, subject, isPending, onConfirm }: Props) {
  const [note, setNote] = useState("");
  useEffect(() => { if (open) setNote(""); }, [open]);
  const approving = action === "approved";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{approving ? "Approve" : "Reject"} request</ResponsiveDialogTitle>
          {subject && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{subject}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        <div className="space-y-2 px-4 sm:px-0">
          <Label htmlFor="reviewNote">Note {approving ? "(optional)" : ""}</Label>
          <Textarea id="reviewNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={approving ? "Add an optional note…" : "Reason for rejection…"} />
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button
            onClick={() => onConfirm(note)}
            disabled={isPending}
            className={approving ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : approving ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {approving ? "Approve" : "Reject"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
