"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, ImagePlus, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRaiseOfficeKeeping } from "@/hooks/useOfficeKeeping";

const MAX_MB = 10;

export function RaiseRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { mutate: raise, isPending } = useRaiseOfficeKeeping();
  const [issue, setIssue] = useState("");
  const [location, setLocation] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setIssue(""); setLocation(""); setPhoto(null); setPreview(""); setError(""); }
  }, [open]);

  // The object URL is the browser's to reclaim; holding it after the preview
  // is gone leaks a little memory every time somebody changes their mind.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | null) => {
    setError("");
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("That needs to be an image."); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`Images must be under ${MAX_MB}MB.`); return; }
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Ask for something to be sorted</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="ok-location">Where is it? *</Label>
            <Input id="ok-location" value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. third floor kitchen" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ok-issue">What needs doing? *</Label>
            <Textarea id="ok-issue" rows={3} value={issue} onChange={(e) => setIssue(e.target.value)}
              placeholder="e.g. the tap is dripping and the sink is backing up" />
          </div>

          <div className="space-y-1.5">
            <Label>Photo <span className="font-normal text-muted-foreground">— optional</span></Label>
            {preview ? (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" className="h-32 rounded-md border border-border object-cover" />
                <button type="button" onClick={() => { URL.revokeObjectURL(preview); setPhoto(null); setPreview(""); }}
                  className="absolute -right-2 -top-2 rounded-full border border-border bg-background p-1 shadow-sm hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" />Add a photo
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={isPending || !issue.trim() || !location.trim()}
              onClick={() => raise({ issue, location, photo }, { onSuccess: () => onOpenChange(false) })}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send it
            </Button>
          </ResponsiveDialogFooter>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
