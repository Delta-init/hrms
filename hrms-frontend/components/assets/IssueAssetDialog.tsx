"use client";
import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, User } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AsyncSelect } from "@/components/ui/async-select";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { issueAssetFormSchema, type IssueAssetFormValues } from "@/lib/validations/assetSchema";
import { useAssets, useAssetHolders, useBulkIssueAssets, useIssueAsset } from "@/hooks/useAssets";
import { ASSET_CONDITION_LABELS, type Asset, type AssetCondition } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The asset to issue — or none, to pick one from available stock. */
  asset: Asset | null;
  /** Issuing to this person: the person/department choice is not shown. */
  employee?: { _id: string; name: string } | null;
  /** Several at once (bulk select on All Assets): all go to the one holder, each keeps its own condition. */
  assets?: Asset[];
  /** After a bulk issue goes through — the page clears its selection. */
  onDone?: () => void;
}

type To = "person" | "department";

/**
 * Who it goes to: a person, or a department.
 *
 * The lists come from the Assets API rather than the employee directory, so whoever issues assets sees everybody
 * even without the Employees module — the Business Administrator couldn't (2026-11-20).
 */
function HolderPicker({ to, value, onChange, enabled }: { to: To; value: string; onChange: (v: string) => void; enabled: boolean }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const { data, isFetching } = useAssetHolders(to, debounced, enabled);
  useEffect(() => setSearch(""), [to]);
  return (
    <AsyncSelect
      value={value}
      onChange={onChange}
      options={(data ?? []).map((h) => ({ value: h._id, label: h.name, sub: h.sub }))}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={to === "person" ? "Select person" : "Select department"}
      searchPlaceholder={to === "person" ? "Search by name or code…" : "Search departments…"}
      emptyText={to === "person" ? "No one found." : "No department found."}
    />
  );
}

/**
 * Issue an asset. From the Assets page the asset is known and the holder is
 * picked — a person or a department; from someone's profile the person is known
 * and the asset is picked from what is available.
 */
export function IssueAssetDialog({ open, onOpenChange, asset, employee = null, assets = [], onDone }: Props) {
  const { mutate: issueOne, isPending: issuingOne } = useIssueAsset();
  const { mutate: issueMany, isPending: issuingMany } = useBulkIssueAssets();
  const isPending = issuingOne || issuingMany;
  const bulk = assets.length > 0;
  const [picked, setPicked] = useState("");
  const pickFromStock = !asset && !bulk;
  const { data: stock, isLoading: stockLoading } = useAssets(open && pickFromStock ? { status: "available", limit: "200", sortBy: "name", sortOrder: "asc" } : undefined);
  const available = stock?.data ?? [];

  const { register, handleSubmit, control, reset, setValue, watch, formState: { errors } } = useForm<IssueAssetFormValues>({
    resolver: zodResolver(issueAssetFormSchema),
    defaultValues: { to: "person", holder: "", condition: asset?.condition ?? "good", notes: "" },
  });
  const to = watch("to");

  useEffect(() => {
    if (open) { reset({ to: "person", holder: employee?._id ?? "", condition: asset?.condition ?? "good", notes: "" }); setPicked(""); }
  }, [open, asset, employee, reset]);

  const switchTo = (next: To) => {
    if (next === to) return;
    setValue("to", next);
    setValue("holder", "", { shouldValidate: false });
  };

  const onSubmit = (data: IssueAssetFormValues) => {
    const holder = employee
      ? { employee: employee._id }
      : data.to === "department" ? { department: data.holder } : { employee: data.holder };
    if (bulk) {
      issueMany({ ids: assets.map((a) => a._id), ...holder, notes: data.notes || undefined }, {
        onSuccess: () => { onOpenChange(false); onDone?.(); },
      });
      return;
    }
    const id = asset?._id ?? picked;
    if (!id) return;
    issueOne({ id, data: { ...holder, condition: data.condition, notes: data.notes } }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{bulk ? `Issue ${assets.length} asset${assets.length === 1 ? "" : "s"}` : "Issue Asset"}</ResponsiveDialogTitle>
          {bulk && (
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              {assets.slice(0, 6).map((a) => a.assetTag).join(", ")}{assets.length > 6 ? ` and ${assets.length - 6} more` : ""} — all to the same holder.
            </ResponsiveDialogDescription>
          )}
          {asset && !bulk && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{asset.name} · {asset.assetTag}</ResponsiveDialogDescription>}
          {!asset && employee && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">To {employee.name}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          {pickFromStock && (
            <div className="space-y-1.5">
              <Label>Asset *</Label>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger><SelectValue placeholder={stockLoading ? "Loading…" : available.length ? "Choose from available stock" : "Nothing available"} /></SelectTrigger>
                <SelectContent>
                  {available.map((a) => <SelectItem key={a._id} value={a._id}>{a.name} · {a.assetTag}</SelectItem>)}
                </SelectContent>
              </Select>
              {!stockLoading && !available.length && <p className="text-xs text-muted-foreground">No asset is available — create a new one instead.</p>}
            </div>
          )}

          {!employee && (
            <div className="space-y-1.5">
              <Label>Issue to *</Label>
              <div role="radiogroup" aria-label="Issue to" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {([["person", "Person", User], ["department", "Department", Building2]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={to === key}
                    onClick={() => switchTo(key)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      to === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
              </div>
              <Controller name="holder" control={control} render={({ field }) => (
                <HolderPicker to={to} value={field.value} onChange={field.onChange} enabled={open} />
              )} />
              {errors.holder && <p className="text-xs text-destructive">{errors.holder.message}</p>}
            </div>
          )}

          {!bulk && <div className="space-y-1.5">
            <Label>Condition at issue</Label>
            <Controller name="condition" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ASSET_CONDITION_LABELS) as AssetCondition[]).map((k) => <SelectItem key={k} value={k}>{ASSET_CONDITION_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </div>}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || (pickFromStock && !picked)}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Issue</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
