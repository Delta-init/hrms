"use client";
import { useEffect, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X, UserRound, User as UserIcon } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { departmentFormSchema, type DepartmentFormValues } from "@/lib/validations/departmentSchema";
import { useCreateDepartment, useUpdateDepartment } from "@/hooks/useDepartments";
import { useEmployees } from "@/hooks/useEmployees";
import { useUsers } from "@/hooks/useUsers";
import type { Department, PersonKind } from "@/types";

const NONE = "__none__";
const keyOf = (kind: PersonKind, id: string) => `${kind}:${id}`;
const parseKey = (k: string) => {
  const [kind, ref] = k.split(":");
  return { kind: kind as PersonKind, ref };
};

interface Person { key: string; kind: PersonKind; id: string; label: string; sub: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department?: Department | null;
}

export function DepartmentDialog({ open, onOpenChange, department }: Props) {
  const isEditing = !!department;
  const { data: empData } = useEmployees({ limit: "200" });
  const { data: usersData } = useUsers({ limit: "200" });
  const { mutate: create, isPending: creating } = useCreateDepartment();
  const { mutate: update, isPending: updating } = useUpdateDepartment();
  const isPending = creating || updating;

  // Combined people list (employees + users) for leader/member pickers.
  const people = useMemo<Person[]>(() => {
    const emps = (empData?.data ?? []).map((e) => ({ key: keyOf("Employee", e._id), kind: "Employee" as const, id: e._id, label: e.name, sub: e.employeeCode }));
    const usrs = (usersData?.data ?? []).map((u) => ({ key: keyOf("User", u._id), kind: "User" as const, id: u._id, label: u.name, sub: u.email }));
    return [...emps, ...usrs];
  }, [empData, usersData]);
  const byKey = useMemo(() => Object.fromEntries(people.map((p) => [p.key, p])), [people]);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentFormSchema),
    defaultValues: { name: "", code: "", description: "", leader: "", members: [], status: "active" },
  });

  useEffect(() => {
    if (!open) return;
    if (department) {
      const leaderId = department.leader ? (typeof department.leader === "object" ? department.leader._id : department.leader) : "";
      const leaderKey = leaderId && department.leaderKind ? keyOf(department.leaderKind, leaderId) : "";
      const memberKeys = (department.members ?? []).map((m) => keyOf(m.kind, typeof m.ref === "object" ? m.ref._id : m.ref));
      reset({
        name: department.name,
        code: department.code ?? "",
        description: department.description ?? "",
        leader: leaderKey,
        members: memberKeys,
        status: department.status,
      });
    } else {
      reset({ name: "", code: "", description: "", leader: "", members: [], status: "active" });
    }
  }, [open, department, reset]);

  const onSubmit = (data: DepartmentFormValues) => {
    const leader = data.leader ? parseKey(data.leader) : null;
    const payload: Record<string, unknown> = {
      name: data.name,
      code: data.code || undefined,
      description: data.description || undefined,
      status: data.status,
      leader: leader?.ref ?? null,
      leaderKind: leader?.kind ?? "Employee",
      members: (data.members ?? []).map(parseKey),
    };
    if (isEditing) update({ id: department._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Department" : "New Department"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" placeholder="e.g. Engineering" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" placeholder="e.g. ENG" {...register("code")} />
          </div>

          {/* Team leader (Employee or User) */}
          <div className="space-y-1.5">
            <Label>Team Leader</Label>
            <Controller
              name="leader"
              control={control}
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {people.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        [{p.kind === "Employee" ? "EMP" : "USER"}] {p.label} · {p.sub}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
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
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Members (Employee or User) */}
          <div className="col-span-2 space-y-1.5">
            <Label>Members</Label>
            <Controller
              name="members"
              control={control}
              render={({ field }) => {
                const selected = field.value ?? [];
                const available = people.filter((p) => !selected.includes(p.key));
                return (
                  <div className="space-y-2">
                    <Select value={NONE} onValueChange={(v) => { if (v !== NONE) field.onChange([...selected, v]); }}>
                      <SelectTrigger><SelectValue placeholder="Add member…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE} disabled>Add member…</SelectItem>
                        {available.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            [{p.kind === "Employee" ? "EMP" : "USER"}] {p.label} · {p.sub}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selected.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selected.map((k) => {
                          const p = byKey[k];
                          if (!p) return null;
                          return (
                            <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pl-2 pr-1 text-xs">
                              {p.kind === "Employee" ? <UserRound className="h-3 w-3 text-primary" /> : <UserIcon className="h-3 w-3 text-indigo-500" />}
                              {p.label}
                              <button type="button" onClick={() => field.onChange(selected.filter((x) => x !== k))} className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={2} placeholder="Optional" {...register("description")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Department"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
