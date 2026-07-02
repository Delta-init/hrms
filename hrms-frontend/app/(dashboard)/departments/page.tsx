"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Building2, Plus, Pencil, Trash2, Loader2, Users as UsersIcon, BarChart3 } from "lucide-react";
import { useDepartments, useDeleteDepartment } from "@/hooks/useDepartments";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { CardToolbar } from "@/components/shared/CardToolbar";
import { Pagination } from "@/components/shared/Pagination";
import { DepartmentDialog } from "@/components/departments/DepartmentDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Department } from "@/types";

const ALL = "__all__";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } };

export default function DepartmentsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("departments", "create");
  const canEdit = hasPermission("departments", "edit");
  const canDelete = hasPermission("departments", "delete");

  const query = useTableQuery({ defaultSortBy: "name", defaultSortOrder: "asc", defaultLimit: 12 });
  const { data, isLoading } = useDepartments(query.params);
  const { mutate: remove, isPending: deleting } = useDeleteDepartment();
  const departments = data?.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Department | null>(null);

  return (
    <div>
      <PageHeader
        title="Departments"
        description="Organise your company into departments."
        icon={Building2}
        action={canCreate && (
          <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm">
            <Plus className="h-4 w-4" />New Department
          </Button>
        )}
      />

      <CardToolbar query={query} placeholder="Search departments…">
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </CardToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : departments.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground">No departments found.</Card>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const leader = typeof d.leader === "object" && d.leader ? d.leader.name : null;
            const memberCount = d.members?.length ?? 0;
            return (
              <motion.div key={d._id} variants={item}>
                <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-lg">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="flex items-center gap-2">
                      {d.code && <Badge variant="outline">{d.code}</Badge>}
                      <Badge variant={d.status === "active" ? "secondary" : "outline"} className="capitalize">{d.status}</Badge>
                    </div>
                  </div>

                  <h3 className="text-base font-semibold">{d.name}</h3>
                  {d.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>}

                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5"><UsersIcon className="h-4 w-4" />{d.employeeCount ?? 0} employees</span>
                      <span>· {memberCount} member{memberCount === 1 ? "" : "s"}</span>
                    </div>
                    {leader && <div>Leader: <span className="font-medium text-foreground">{leader}</span></div>}
                  </div>

                  <div className="mt-4 flex gap-2 border-t border-border pt-4">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/departments/${d._id}`}><BarChart3 className="h-3.5 w-3.5" />View report</Link>
                    </Button>
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={() => { setSelected(d); setDialogOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => { setSelected(d); setDeleteOpen(true); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {!isLoading && data?.pagination && data.pagination.total > 0 && (
        <Card className="mt-4 overflow-hidden">
          <Pagination pagination={data.pagination} page={query.page} limit={query.limit} onPageChange={query.setPage} onLimitChange={query.setLimit} label="departments" />
        </Card>
      )}

      <DepartmentDialog open={dialogOpen} onOpenChange={setDialogOpen} department={selected} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete department"
        description="Employees in it must be reassigned first."
        isPending={deleting}
        onConfirm={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })}
      />
    </div>
  );
}
