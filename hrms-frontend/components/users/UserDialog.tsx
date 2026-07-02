"use client";
import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, Info } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createUserSchema, updateUserSchema,
  type CreateUserFormValues, type UpdateUserFormValues,
} from "@/lib/validations/userSchema";
import { useCreateUser, useUpdateUser } from "@/hooks/useUsers";
import { useRolesSimple } from "@/hooks/useRoles";
import { useWorkSchedulesSimple } from "@/hooks/useWorkSchedules";
import type { User } from "@/types";

const NONE = "__none__";

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
}

export function UserDialog({ open, onOpenChange, user }: UserDialogProps) {
  const isEditing = !!user;
  const [showPassword, setShowPassword] = useState(false);
  const { data: roles = [], isLoading: rolesLoading } = useRolesSimple();
  const { data: schedules = [] } = useWorkSchedulesSimple();
  const { mutate: createUser, isPending: creating } = useCreateUser();
  const { mutate: updateUser, isPending: updating } = useUpdateUser();
  const isPending = creating || updating;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(isEditing ? updateUserSchema : createUserSchema) as never,
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "",
      designation: "",
      workSchedule: "",
      status: "active",
    },
  });

  useEffect(() => {
    if (open) {
      if (user) {
        reset({
          name: user.name,
          email: user.email,
          password: "",
          role: typeof user.role === "object" ? user.role._id : user.role,
          designation: user.designation ?? "",
          workSchedule: user.workSchedule
            ? (typeof user.workSchedule === "object" ? user.workSchedule._id : user.workSchedule)
            : "",
          status: user.status,
        });
      } else {
        reset({ name: "", email: "", password: "", role: "", designation: "", workSchedule: "", status: "active" });
      }
    }
  }, [open, user, reset]);

  const onSubmit = (data: CreateUserFormValues) => {
    const payload = { ...data, workSchedule: data.workSchedule || null };
    if (isEditing && !payload.password) {
      delete (payload as Partial<CreateUserFormValues>).password;
    }

    if (isEditing) {
      updateUser(
        { id: user._id, data: payload as UpdateUserFormValues },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createUser(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit User" : "Create New User"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          {!isEditing && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                You set a temporary password here. Share it with the employee — they sign in via
                the <strong className="text-foreground">Activate account</strong> screen to set
                their own password.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Full Name *</Label>
              <Input id="name" placeholder="John Doe" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            {/* Email */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="email">Email Address *</Label>
              <Input id="email" type="email" placeholder="john@example.com" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="password">
                {isEditing ? (
                  <>Password <span className="text-muted-foreground font-normal">(leave blank to keep)</span></>
                ) : (
                  <>Temporary Password *</>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isEditing ? "Leave blank to keep current" : "Min 8 chars, upper, lower, number"}
                  className="pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            {/* Role */}
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={rolesLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role._id} value={role._id}>{role.roleName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="invited">Invited</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Designation */}
            <div className="space-y-1.5">
              <Label htmlFor="designation">Designation</Label>
              <Input id="designation" placeholder="e.g. HR Executive" {...register("designation")} />
            </div>

            {/* Work Schedule (assign) */}
            <div className="space-y-1.5">
              <Label>Work Schedule</Label>
              <Controller
                name="workSchedule"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value || NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {schedules.map((s) => (
                        <SelectItem key={s._id} value={s._id}>{s.name} · {s.timeZone}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create User"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
