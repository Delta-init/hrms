"use client";
import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff, KeyRound } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateEmployeeLogin } from "@/hooks/useEmployees";
import { useRolesSimple } from "@/hooks/useRoles";
import type { Employee } from "@/types";

const schema = z.object({
  email: z.string().email("Invalid email"),
  role: z.string().min(1, "Role is required"),
  temporaryPassword: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "One uppercase required")
    .regex(/[a-z]/, "One lowercase required")
    .regex(/[0-9]/, "One number required"),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}

export function CreateLoginDialog({ open, onOpenChange, employee }: Props) {
  const { data: roles = [] } = useRolesSimple();
  const { mutate: createLogin, isPending } = useCreateEmployeeLogin();
  const [show, setShow] = useState(false);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "", temporaryPassword: "" },
  });

  useEffect(() => {
    if (open) reset({ email: employee?.email ?? "", role: "", temporaryPassword: "" });
  }, [open, employee, reset]);

  const onSubmit = (data: FormValues) => {
    if (!employee) return;
    createLogin({ id: employee._id, data }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 px-4 sm:px-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <ResponsiveDialogTitle>Create login for {employee?.name}</ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className="px-4 pt-2 sm:px-0">
            Sets a temporary password. The employee activates their account and sets
            their own password on first sign-in.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="email">Login Email *</Label>
            <Input id="email" type="email" placeholder="employee@company.com" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => <SelectItem key={r._id} value={r._id}>{r.roleName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="temporaryPassword">Temporary Password *</Label>
            <div className="relative">
              <Input id="temporaryPassword" type={show ? "text" : "password"} placeholder="Min 8, upper, lower, number" className="pr-10" {...register("temporaryPassword")} />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.temporaryPassword && <p className="text-xs text-destructive">{errors.temporaryPassword.message}</p>}
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Login
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
