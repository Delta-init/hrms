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
import { procurementFormSchema, type ProcurementFormValues } from "@/lib/validations/procurementSchema";
import { useCreateProcurement, useUpdateProcurement } from "@/hooks/useProcurements";
import { useDepartmentsSimple } from "@/hooks/useDepartments";
import {
  PROCUREMENT_KIND_LABELS, PROCUREMENT_STATUS_LABELS,
  type Procurement, type ProcurementKind, type ProcurementStatus,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  procurement?: Procurement | null;
}

const NONE = "__none__";
const EMPTY: ProcurementFormValues = {
  kind: "existing", item: "", category: "", quantity: 1, estimatedCost: undefined, vendor: "",
  department: "", neededBy: "", justification: "", status: "requested", notes: "",
};

const idOf = (v: Procurement["department"]) => (v && typeof v === "object" ? v._id : (v ?? "")) || "";
const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function ProcurementDialog({ open, onOpenChange, procurement }: Props) {
  const isEditing = !!procurement;
  const { mutate: create, isPending: creating } = useCreateProcurement();
  const { mutate: update, isPending: updating } = useUpdateProcurement();
  const { data: departments = [] } = useDepartmentsSimple({ enabled: open });
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<ProcurementFormValues>({
    resolver: zodResolver(procurementFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      procurement
        ? {
            kind: procurement.kind,
            item: procurement.item,
            category: procurement.category ?? "",
            quantity: procurement.quantity ?? 1,
            estimatedCost: procurement.estimatedCost ?? undefined,
            vendor: procurement.vendor ?? "",
            department: idOf(procurement.department),
            neededBy: toDateInput(procurement.neededBy),
            justification: procurement.justification ?? "",
            status: procurement.status,
            notes: procurement.notes ?? "",
          }
        : EMPTY
    );
  }, [open, procurement, reset]);

  const kind = watch("kind");
  // A new request is decided by HR and finance, so its status is theirs to set,
  // not something typed into this form.
  const statusEditable = kind === "existing";

  const onSubmit = (data: ProcurementFormValues) => {
    const payload = {
      ...data,
      department: data.department || null,
      neededBy: data.neededBy || null,
      vendor: data.vendor || "",
    };
    if (isEditing) update({ id: procurement._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const field = "space-y-1.5";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Procurement" : "New Procurement"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className={`${field} col-span-2`}>
            <Label>Kind *</Label>
            <Controller
              control={control}
              name="kind"
              render={({ field: f }) => (
                <Select value={f.value} onValueChange={f.onChange} disabled={isEditing}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROCUREMENT_KIND_LABELS) as ProcurementKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{PROCUREMENT_KIND_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              {kind === "new"
                ? "Goes to HR, then to finance. You will be emailed either way."
                : "A record of something already bought — nobody needs to approve it."}
            </p>
          </div>

          <div className={`${field} col-span-2`}>
            <Label htmlFor="item">Item *</Label>
            <Input id="item" placeholder="e.g. Dell 24&quot; monitor" {...register("item")} />
            {errors.item && <p className="text-xs text-destructive">{errors.item.message}</p>}
          </div>

          <div className={field}>
            <Label htmlFor="category">Category</Label>
            <Input id="category" placeholder="e.g. furniture" {...register("category")} />
          </div>
          <div className={field}>
            <Label htmlFor="quantity">Quantity *</Label>
            <Input id="quantity" type="number" min="1" {...register("quantity")} />
            {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
          </div>

          <div className={field}>
            <Label htmlFor="estimatedCost">Estimated cost (AED)</Label>
            <Input id="estimatedCost" type="number" min="0" step="0.01" placeholder="For the whole quantity" {...register("estimatedCost")} />
          </div>
          <div className={field}>
            <Label htmlFor="vendor">Suggested vendor</Label>
            <Input id="vendor" placeholder="Optional" {...register("vendor")} />
          </div>

          <div className={field}>
            <Label>Department</Label>
            <Controller
              control={control}
              name="department"
              render={({ field: f }) => (
                <Select value={f.value || NONE} onValueChange={(v) => f.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className={field}>
            <Label htmlFor="neededBy">Needed by</Label>
            <Input id="neededBy" type="date" {...register("neededBy")} />
          </div>

          {statusEditable && (
          <div className={field}>
            <Label>Status</Label>
            <Controller
              control={control}
              name="status"
              render={({ field: f }) => (
                <Select value={f.value} onValueChange={f.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["ordered", "received", "cancelled"] as ProcurementStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{PROCUREMENT_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          )}

          <div className={`${field} col-span-2`}>
            <Label htmlFor="justification">Why it is needed</Label>
            <Textarea id="justification" rows={2} placeholder="Optional" {...register("justification")} />
          </div>
          <div className={`${field} col-span-2`}>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Add Procurement"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
