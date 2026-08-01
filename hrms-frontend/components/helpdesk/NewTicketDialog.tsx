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
import { ticketFormSchema, type TicketFormValues } from "@/lib/validations/helpdeskSchema";
import { useCreateTicket } from "@/hooks/useHelpdesk";
import { HELPDESK_CATEGORY_LABELS, HELPDESK_PRIORITY_LABELS, type HelpdeskCategory, type HelpdeskPriority } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY: TicketFormValues = { subject: "", description: "", category: "other", priority: "medium" };

export function NewTicketDialog({ open, onOpenChange }: Props) {
  const { mutate: create, isPending } = useCreateTicket();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => { if (open) reset(EMPTY); }, [open, reset]);

  const onSubmit = (data: TicketFormValues) => {
    create(data, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Support Ticket</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject *</Label>
            <Input id="subject" placeholder="e.g. Laptop won't turn on" {...register("subject")} />
            {errors.subject && <p className="text-xs text-destructive">{errors.subject.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description *</Label>
            <Textarea id="description" rows={5} placeholder="Describe the issue…" {...register("description")} />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HELPDESK_CATEGORY_LABELS) as HelpdeskCategory[]).map((c) => (
                      <SelectItem key={c} value={c}>{HELPDESK_CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Controller name="priority" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HELPDESK_PRIORITY_LABELS) as HelpdeskPriority[]).map((p) => (
                      <SelectItem key={p} value={p}>{HELPDESK_PRIORITY_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit Ticket
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
