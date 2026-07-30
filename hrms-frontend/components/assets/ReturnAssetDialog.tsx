"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { returnAssetFormSchema, type ReturnAssetFormValues } from "@/lib/validations/assetSchema";
import { useReturnAsset } from "@/hooks/useAssets";
import { ASSET_CONDITION_LABELS, type Asset, type AssetCondition } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
}

const empName = (a: Asset | null) => (a?.assignedTo && typeof a.assignedTo === "object" ? a.assignedTo.name : "");

export function ReturnAssetDialog({ open, onOpenChange, asset }: Props) {
  const { mutate: returnAsset, isPending } = useReturnAsset();

  const { register, handleSubmit, control, watch, reset } = useForm<ReturnAssetFormValues>({
    resolver: zodResolver(returnAssetFormSchema),
    defaultValues: { condition: "good", sendToMaintenance: false, notes: "" },
  });
  const condition = watch("condition");

  useEffect(() => {
    if (open) reset({ condition: asset?.condition ?? "good", sendToMaintenance: false, notes: "" });
  }, [open, asset, reset]);

  const onSubmit = (data: ReturnAssetFormValues) => {
    if (!asset) return;
    returnAsset({ id: asset._id, data }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Return Asset</ResponsiveDialogTitle>
          {asset && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{asset.name} · from {empName(asset)}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Condition on return *</Label>
            <Controller name="condition" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ASSET_CONDITION_LABELS) as AssetCondition[]).map((k) => <SelectItem key={k} value={k}>{ASSET_CONDITION_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </div>

          {condition !== "damaged" && (
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Send to maintenance</p>
                <p className="text-[11px] text-muted-foreground">Instead of returning it straight to the available pool.</p>
              </div>
              <Controller name="sendToMaintenance" control={control} render={({ field }) => (
                <Switch checked={!!field.value} onCheckedChange={field.onChange} />
              )} />
            </div>
          )}
          {condition === "damaged" && (
            <p className="text-xs text-amber-600">Damaged returns are routed to maintenance automatically.</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Return</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
