"use client";
import { Printer } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { printLetter } from "./printLetter";
import { LETTER_CATEGORY_LABELS, type GeneratedLetter } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  letter: GeneratedLetter | null;
}

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso)) : "—");

export function ViewLetterDialog({ open, onOpenChange, letter }: Props) {
  const emp = letter && typeof letter.employee === "object" ? letter.employee : null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[85vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{letter?.subject}</ResponsiveDialogTitle>
          {letter && (
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              {emp?.name ?? "—"} · {LETTER_CATEGORY_LABELS[letter.category]} · Issued {fmtDate(letter.issuedAt)}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        {letter && (
          <div className="px-4 sm:px-0">
            <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed">
              {letter.content}
            </div>
            {letter.notes && <p className="mt-3 text-xs text-muted-foreground">Note: {letter.notes}</p>}
          </div>
        )}

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" onClick={() => letter && printLetter(letter)}><Printer className="h-4 w-4" />Print / PDF</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
