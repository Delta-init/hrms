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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { announcementFormSchema, type AnnouncementFormValues } from "@/lib/validations/announcementSchema";
import { useCreateAnnouncement, useUpdateAnnouncement } from "@/hooks/useAnnouncements";
import { ANNOUNCEMENT_CATEGORY_LABELS, type Announcement, type AnnouncementCategory } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  announcement?: Announcement | null;
}

const EMPTY: AnnouncementFormValues = { title: "", body: "", category: "general", pinned: false };

export function AnnouncementDialog({ open, onOpenChange, announcement }: Props) {
  const isEditing = !!announcement;
  const { mutate: create, isPending: creating } = useCreateAnnouncement();
  const { mutate: update, isPending: updating } = useUpdateAnnouncement();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (announcement) {
      reset({ title: announcement.title, body: announcement.body, category: announcement.category, pinned: announcement.pinned });
    } else {
      reset(EMPTY);
    }
  }, [open, announcement, reset]);

  const onSubmit = (data: AnnouncementFormValues) => {
    if (isEditing) update({ id: announcement._id, data }, { onSuccess: () => onOpenChange(false) });
    else create(data, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Announcement" : "New Announcement"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" placeholder="e.g. Office closed for National Day" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Message *</Label>
            <Textarea id="body" rows={5} placeholder="Write the announcement…" {...register("body")} />
            {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ANNOUNCEMENT_CATEGORY_LABELS) as AnnouncementCategory[]).map((c) => (
                      <SelectItem key={c} value={c}>{ANNOUNCEMENT_CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Pin</p>
                <p className="text-[11px] text-muted-foreground">Keep at the top of the feed.</p>
              </div>
              <Controller name="pinned" control={control} render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )} />
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Post Announcement"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
