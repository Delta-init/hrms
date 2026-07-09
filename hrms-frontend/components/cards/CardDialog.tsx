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
import { cardFormSchema, type CardFormValues } from "@/lib/validations/cardSchema";
import { useCreateCard, useUpdateCard } from "@/hooks/useCards";
import { useUsers } from "@/hooks/useUsers";
import type { Card } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card?: Card | null;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

export function CardDialog({ open, onOpenChange, card }: Props) {
  const isEditing = !!card;
  const { data: usersData } = useUsers({ limit: "200" });
  const users = usersData?.data ?? [];
  const { mutate: create, isPending: creating } = useCreateCard();
  const { mutate: update, isPending: updating } = useUpdateCard();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: { cardNumber: "", name: "", client: "", issueDate: "", expiryDate: "", notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (card) {
      reset({
        cardNumber: card.cardNumber, name: card.name, client: idOf(card.client),
        issueDate: toDateInput(card.issueDate), expiryDate: toDateInput(card.expiryDate), notes: card.notes ?? "",
      });
    } else {
      reset({ cardNumber: "", name: "", client: "", issueDate: "", expiryDate: "", notes: "" });
    }
  }, [open, card, reset]);

  const onSubmit = (data: CardFormValues) => {
    const payload = {
      ...data,
      issueDate: data.issueDate || null,
      expiryDate: data.expiryDate || null,
      notes: data.notes || undefined,
    };
    if (isEditing) update({ id: card._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Card" : "New Card"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="cardNumber">Card Number *</Label>
            <Input id="cardNumber" placeholder="CARD-0001" {...register("cardNumber")} />
            {errors.cardNumber && <p className="text-xs text-destructive">{errors.cardNumber.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name on Card *</Label>
            <Input id="name" placeholder="Jane Doe" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Client *</Label>
            <Controller name="client" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select a client (user)" /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u._id} value={u._id}>{u.name} — {u.email}</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.client && <p className="text-xs text-destructive">{errors.client.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="issueDate">Issue Date</Label>
              <Input id="issueDate" type="date" {...register("issueDate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input id="expiryDate" type="date" {...register("expiryDate")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create Card"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
