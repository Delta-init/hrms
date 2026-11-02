"use client";
import { useEffect, useState } from "react";
import { Loader2, PackageCheck, Minus, Plus } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReceiveProcurement } from "@/hooks/useProcurements";
import type { Procurement } from "@/types";

/**
 * It has arrived. Moves something finance approved, or something ordered, to
 * received — which is what puts it on the Ledger's shelf to be given out. The
 * count is what actually came, which is not always what was asked for.
 */
export function ReceiveProcurementDialog({ procurement, onClose }: { procurement: Procurement | null; onClose: () => void }) {
  const { mutate: receive, isPending } = useReceiveProcurement();
  const [quantity, setQuantity] = useState(1);
  const [shown, setShown] = useState<Procurement | null>(null);
  useEffect(() => { if (procurement) { setShown(procurement); setQuantity(procurement.quantity || 1); } }, [procurement]);
  const valid = Number.isInteger(quantity) && quantity >= 1;

  return (
    <ResponsiveDialog open={!!procurement} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Mark received</ResponsiveDialogTitle>
          {shown && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{shown.item} · {shown.quantity} asked for</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        <div className="space-y-2 px-4 sm:px-0">
          <Label>How many arrived</Label>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="outline" aria-label="One fewer" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.floor(Number(e.target.value) || 0))} className="w-24 text-center tabular-nums" />
            <Button type="button" size="icon" variant="outline" aria-label="One more" onClick={() => setQuantity((q) => q + 1)}><Plus className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs text-muted-foreground">It goes on the Ledger as received today, ready to give out.</p>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!procurement || !valid || isPending} onClick={() => procurement && receive({ id: procurement._id, quantity }, { onSuccess: onClose })}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}Received
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
