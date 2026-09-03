"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
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
import { useCreateProgram, useUpdateProgram } from "@/hooks/usePrograms";
import { PROGRAM_STATUS_LABELS, type Program, type ProgramStatus } from "@/types";

interface Values {
  title: string; description: string; location: string;
  startsAt: string; endsAt: string; capacity: number; status: ProgramStatus;
}

/** `datetime-local` wants the local wall clock, not an ISO string with a zone. */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ProgramDialog({
  open, onOpenChange, program,
}: { open: boolean; onOpenChange: (v: boolean) => void; program: Program | null }) {
  const isEditing = !!program;
  const { mutate: create, isPending: creating } = useCreateProgram();
  const { mutate: update, isPending: updating } = useUpdateProgram();
  const pending = creating || updating;

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<Values>({
    defaultValues: { title: "", description: "", location: "", startsAt: "", endsAt: "", capacity: 0, status: "draft" },
  });

  useEffect(() => {
    if (!open) return;
    reset(program
      ? {
          title: program.title, description: program.description ?? "", location: program.location ?? "",
          startsAt: toLocalInput(program.startsAt), endsAt: toLocalInput(program.endsAt),
          capacity: program.capacity, status: program.status,
        }
      : { title: "", description: "", location: "", startsAt: "", endsAt: "", capacity: 0, status: "draft" });
  }, [open, program, reset]);

  const capacity = Number(watch("capacity") ?? 0);

  const onSubmit = (v: Values) => {
    const payload = {
      title: v.title.trim(),
      description: v.description?.trim() || undefined,
      location: v.location?.trim() || undefined,
      startsAt: new Date(v.startsAt).toISOString(),
      endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null,
      capacity: Number(v.capacity) || 0,
      status: v.status,
    };
    const done = { onSuccess: () => onOpenChange(false) };
    if (isEditing) update({ id: program._id, data: payload }, done);
    else create(payload, done);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit program" : "New program"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input {...register("title", { required: "A title is required" })} placeholder="First-aid refresher" />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} {...register("description")} placeholder="What it covers, who it is for." />
          </div>

          <div className="space-y-1.5">
            <Label>Where</Label>
            <Input {...register("location")} placeholder="Training room, or a meeting link" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Starts *</Label>
              <Input type="datetime-local" {...register("startsAt", { required: "A start time is required" })} />
              {errors.startsAt && <p className="text-xs text-destructive">{errors.startsAt.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Ends</Label>
              <Input type="datetime-local" {...register("endsAt")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Places</Label>
              <Input type="number" min={0} {...register("capacity")} />
              {/* Zero is a real answer, not a missing one, so it says what it
                  means rather than leaving somebody to type 999. */}
              <p className="text-[11px] text-muted-foreground">
                {capacity > 0 ? `${capacity} people can register.` : "0 means no limit — everybody may register."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PROGRAM_STATUS_LABELS) as ProgramStatus[]).map((st) => (
                        <SelectItem key={st} value={st}>{PROGRAM_STATUS_LABELS[st]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {/* Said where the choice is made: publishing is what notifies
                  everybody, and it happens once. */}
              <p className="text-[11px] text-muted-foreground">
                Only <strong>Open</strong> programs are visible to staff. Publishing one notifies everybody.
              </p>
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save" : "Create"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
