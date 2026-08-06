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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { issueAssetFormSchema, type IssueAssetFormValues } from "@/lib/validations/assetSchema";
import { useIssueAsset } from "@/hooks/useAssets";
import { ASSET_CONDITION_LABELS, type Asset, type AssetCondition } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
}

export function IssueAssetDialog({ open, onOpenChange, asset }: Props) {
  const { mutate: issue, isPending } = useIssueAsset();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<IssueAssetFormValues>({
    resolver: zodResolver(issueAssetFormSchema),
    defaultValues: { employee: "", condition: asset?.condition ?? "good", notes: "" },
  });

  useEffect(() => {
    if (open) reset({ employee: "", condition: asset?.condition ?? "good", notes: "" });
  }, [open, asset, reset]);

  const onSubmit = (data: IssueAssetFormValues) => {
    if (!asset) return;
    issue({ id: asset._id, data }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Issue Asset</ResponsiveDialogTitle>
          {asset && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{asset.name} · {asset.assetTag}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <Controller name="employee" control={control} render={({ field }) => (
              <EmployeeSelect value={field.value} onChange={field.onChange} placeholder="Select employee" />
            )} />
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Condition at issue</Label>
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
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Issue</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
