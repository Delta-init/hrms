"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assetFormSchema, type AssetFormValues } from "@/lib/validations/assetSchema";
import { useCreateAsset, useUpdateAsset } from "@/hooks/useAssets";
import { ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS, type Asset, type AssetCategory, type AssetCondition } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset | null;
}

const EMPTY: AssetFormValues = { name: "", category: "laptop", assetTag: "", serialNumber: "", purchaseDate: "", purchaseCost: undefined, condition: "new", notes: "" };

export function AssetDialog({ open, onOpenChange, asset }: Props) {
  const isEditing = !!asset;
  const { mutate: create, isPending: creating } = useCreateAsset();
  const { mutate: update, isPending: updating } = useUpdateAsset();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (asset) {
      reset({
        name: asset.name, category: asset.category, assetTag: asset.assetTag,
        serialNumber: asset.serialNumber ?? "", purchaseDate: asset.purchaseDate?.slice(0, 10) ?? "",
        purchaseCost: asset.purchaseCost, condition: asset.condition, notes: asset.notes ?? "",
      });
    } else {
      reset(EMPTY);
    }
  }, [open, asset, reset]);

  const onSubmit = (data: AssetFormValues) => {
    const payload = {
      ...data,
      serialNumber: data.serialNumber || undefined,
      purchaseDate: data.purchaseDate || undefined,
      notes: data.notes || undefined,
    };
    if (isEditing) update({ id: asset._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Asset" : "New Asset"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="e.g. MacBook Pro 14&quot;" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[]).map((k) => <SelectItem key={k} value={k}>{ASSET_CATEGORY_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="assetTag">Asset tag *</Label>
              <Input id="assetTag" placeholder="e.g. AST-0042" {...register("assetTag")} />
              {errors.assetTag && <p className="text-xs text-destructive">{errors.assetTag.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serialNumber">Serial number</Label>
              <Input id="serialNumber" placeholder="Optional" {...register("serialNumber")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="purchaseDate">Purchase date</Label>
              <Input id="purchaseDate" type="date" {...register("purchaseDate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purchaseCost">Purchase cost</Label>
              <Input id="purchaseCost" type="number" min="0" step="0.01" placeholder="Optional" {...register("purchaseCost")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Condition *</Label>
            <Controller name="condition" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ASSET_CONDITION_LABELS) as AssetCondition[]).map((k) => <SelectItem key={k} value={k}>{ASSET_CONDITION_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Add Asset"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
