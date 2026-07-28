"use client";
import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Layers, UserPlus } from "lucide-react";
import { useSalaryStructures, useDeleteStructure, useAssignments, useDeleteAssignment } from "@/hooks/useSalaryStructures";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SalaryStructureDialog } from "@/components/payroll/SalaryStructureDialog";
import { AssignStructureDialog } from "@/components/payroll/AssignStructureDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import { SALARY_COMPONENT_CALC_LABELS, type SalaryStructure, type SalaryStructureAssignment } from "@/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; };
const empOf = (a: SalaryStructureAssignment) => (a.employee && typeof a.employee === "object" ? a.employee : null);
const structOf = (a: SalaryStructureAssignment) => (a.structure && typeof a.structure === "object" ? a.structure : null);
const num = (n: number) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function SalaryStructures() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("payroll", "create");
  const canEdit = hasPermission("payroll", "edit");
  const canDelete = hasPermission("payroll", "delete");

  const { data: structData, isLoading } = useSalaryStructures({ limit: "200" });
  const structures = structData?.data ?? [];
  const { data: assignData, isLoading: assignLoading } = useAssignments({ limit: "200" });
  const assignments = assignData?.data ?? [];
  const { mutate: removeStructure, isPending: deletingStruct } = useDeleteStructure();
  const { mutate: removeAssignment, isPending: deletingAssign } = useDeleteAssignment();

  const [structDialog, setStructDialog] = useState(false);
  const [editStruct, setEditStruct] = useState<SalaryStructure | null>(null);
  const [deleteStruct, setDeleteStruct] = useState<SalaryStructure | null>(null);

  const [assignDialog, setAssignDialog] = useState(false);
  const [editAssign, setEditAssign] = useState<SalaryStructureAssignment | null>(null);
  const [deleteAssign, setDeleteAssign] = useState<SalaryStructureAssignment | null>(null);

  const openStruct = (s: SalaryStructure | null) => { setEditStruct(s); setStructDialog(true); };
  const openAssign = (a: SalaryStructureAssignment | null) => { setEditAssign(a); setAssignDialog(true); };

  return (
    <div className="space-y-4">
      {/* Templates */}
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Salary Structures</h3>
            <span className="text-xs text-muted-foreground">Reusable breakup templates</span>
          </div>
          {canCreate && <Button size="sm" onClick={() => openStruct(null)}><Plus className="h-4 w-4" />New Structure</Button>}
        </div>
        {isLoading ? (
          <div className="py-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : structures.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground"><Layers className="mx-auto mb-2 h-7 w-7" />No salary structures yet.</div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {structures.map((s) => (
              <div key={s._id} className="rounded-lg border border-border p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    {s.description && <p className="truncate text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openStruct(s)}><Pencil className="h-3.5 w-3.5" /></Button>}
                    {canDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteStruct(s)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </div>
                </div>
                {s.components.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Basic only</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {s.components.map((c, i) => (
                      <span key={i} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", c.type === "earning" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-red-500/20 bg-red-500/10 text-red-600")}>
                        {c.name} · {c.calc === "percent" ? `${c.value}%` : num(c.value)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Assignments */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Employee Assignments</h3>
            <span className="text-xs text-muted-foreground">Effective-dated — a raise is a new assignment</span>
          </div>
          {canCreate && <Button size="sm" variant="outline" onClick={() => openAssign(null)} disabled={structures.length === 0}><Plus className="h-4 w-4" />Assign</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Structure</th>
                <th className="px-4 py-3 text-right font-medium">Basic</th>
                <th className="px-4 py-3 font-medium">Effective</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {assignLoading ? (
                <tr><td colSpan={5} className="py-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : assignments.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-muted-foreground"><UserPlus className="mx-auto mb-2 h-7 w-7" />No structures assigned yet.</td></tr>
              ) : assignments.map((a) => {
                const e = empOf(a); const st = structOf(a);
                return (
                  <tr key={a._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                        <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{st?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(a.basicAmount)}</td>
                    <td className="px-4 py-3">{fmtMonth(a.effectiveMonth)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openAssign(a)}><Pencil className="h-4 w-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteAssign(a)}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <SalaryStructureDialog open={structDialog} onOpenChange={setStructDialog} structure={editStruct} />
      <AssignStructureDialog open={assignDialog} onOpenChange={setAssignDialog} assignment={editAssign} />

      <ConfirmDialog
        open={!!deleteStruct} onOpenChange={(o) => !o && setDeleteStruct(null)}
        title="Delete salary structure" description="This template will be permanently removed. Employees currently assigned to it must be reassigned first." isPending={deletingStruct}
        onConfirm={() => deleteStruct && removeStructure(deleteStruct._id, { onSuccess: () => setDeleteStruct(null) })}
      />
      <ConfirmDialog
        open={!!deleteAssign} onOpenChange={(o) => !o && setDeleteAssign(null)}
        title="Remove assignment" description="This structure assignment will be removed. Payroll will fall back to the earlier structure or plain salary." isPending={deletingAssign}
        onConfirm={() => deleteAssign && removeAssignment(deleteAssign._id, { onSuccess: () => setDeleteAssign(null) })}
      />
    </div>
  );
}
