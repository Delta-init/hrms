"use client";
import { useId, useState } from "react";
import { Folder, FolderInput, Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Folders only group things on the page: a folder is the name the items in it
 * share, nothing more. Picking one offers the names already in use; typing a
 * new name makes a new folder.
 */

/** A folder name: pick one in use, or type a new one. Empty means no folder. */
export function FolderField({ value, onChange, options, disabled, label = "Folder" }: {
  value: string; onChange: (v: string) => void; options: string[]; disabled?: boolean; label?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-folder`}>{label} <span className="font-normal text-muted-foreground">(optional)</span></Label>
      <Input id={`${id}-folder`} list={`${id}-folders`} maxLength={80} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} placeholder={options[0] ? `e.g. ${options[0]}` : "e.g. Week 1 · Sales basics"} />
      <datalist id={`${id}-folders`}>
        {options.map((f) => <option key={f} value={f} />)}
      </datalist>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.slice(0, 8).map((f) => (
            <button key={f} type="button" disabled={disabled} onClick={() => onChange(f)}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">
              <Folder className="h-3 w-3" />{f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Items grouped by folder, in the order each folder first appears; those in none come first. */
export function groupByFolder<T extends { folder: string }>(items: T[]): { folder: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.folder ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const out = Array.from(groups.entries()).map(([folder, list]) => ({ folder, items: list }));
  return [...out.filter((g) => !g.folder), ...out.filter((g) => g.folder)];
}

export function FolderHeading({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 pt-1 text-sm font-medium text-muted-foreground">
      <Folder className="h-4 w-4" />{name}<span className="font-normal">· {count}</span>
    </div>
  );
}

/** The small "Move" button, and the dialog it opens. */
export function MoveToFolder({ current, options, busy, onMove }: {
  current: string; options: string[]; busy: boolean; onMove: (folder: string, done: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  return (
    <>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => { setValue(current); setOpen(true); }}>
        <FolderInput className="h-3.5 w-3.5" />{current ? "Move" : "Put in a folder"}
      </Button>
      {open && (
        <ResponsiveDialog open onOpenChange={(o) => { if (!o && !busy) setOpen(false); }}>
          <ResponsiveDialogContent desktopClassName="max-w-sm">
            <ResponsiveDialogHeader><ResponsiveDialogTitle>Move to a folder</ResponsiveDialogTitle></ResponsiveDialogHeader>
            <div className="min-w-0 space-y-2 px-4 sm:px-0">
              <FolderField value={value} onChange={setValue} options={options} disabled={busy} />
              <p className="text-xs text-muted-foreground">Leave it empty to take it out of any folder.</p>
            </div>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button disabled={busy || value.trim() === current} onClick={() => onMove(value.trim(), () => setOpen(false))}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Move
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </>
  );
}
