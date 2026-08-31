"use client";
import { useEffect, useState } from "react";
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
import { assetCategoryLabel, ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS, type Asset, type AssetCondition } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset | null;
}

const EMPTY: AssetFormValues = { name: "", category: "laptop", assetTag: "", serialNumber: "", purchaseDate: "", purchaseCost: undefined, condition: "new", branch: "", location: "", quantity: 1, notes: "" };

/** Picked from the dropdown to type a category nobody has used before. */
const CUSTOM = "__custom__";

export function AssetDialog({ open, onOpenChange, asset }: Props) {
  const isEditing = !!asset;
  const { mutate: create, isPending: creating } = useCreateAsset();
  const { mutate: update, isPending: updating } = useUpdateAsset();
  const isPending = creating || updating;

  // Kept outside the form value so the text box stays open while it is empty.
  const [customCategory, setCustomCategory] = useState(false);

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
        purchaseCost: asset.purchaseCost, condition: asset.condition,
        branch: asset.branch ?? "", location: asset.location ?? "", quantity: asset.quantity ?? 1,
        notes: asset.notes ?? "",
      });
      setCustomCategory(false);
    } else {
      reset(EMPTY);
      setCustomCategory(false);
    }
  }, [open, asset, reset]);

  const onSubmit = (data: AssetFormValues) => {
    const payload = {
      ...data,
      serialNumber: data.serialNumber || undefined,
      purchaseDate: data.purchaseDate || undefined,
      branch: data.branch || undefined,
      location: data.location || undefined,
      quantity: data.quantity || 1,
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
                customCategory ? (
                  <Input
                    autoFocus
                    placeholder="e.g. Projector"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={() => { if (!field.value.trim()) { field.onChange("other"); setCustomCategory(false); } }}
                  />
                ) : (
                  <Select
                    value={field.value}
                    onValueChange={(v) => { if (v === CUSTOM) { setCustomCategory(true); field.onChange(""); } else field.onChange(v); }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {/* Anything the register already holds that we have no label
                          for still has to be selectable, or editing it silently
                          reclassifies the asset. */}
                      {Array.from(new Set([...Object.keys(ASSET_CATEGORY_LABELS), field.value].filter(Boolean))).map((k) => (
                        <SelectItem key={k} value={k}>{assetCategoryLabel(k)}</SelectItem>
                      ))}
                      <SelectItem value={CUSTOM}>Something else…</SelectItem>
                    </SelectContent>
                  </Select>
                )
              )} />
              {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
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

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="branch">Branch</Label>
              <Input id="branch" placeholder="e.g. 410 Office" {...register("branch")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Meeting room 1" {...register("location")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" type="number" min="1" step="1" {...register("quantity")} />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
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
