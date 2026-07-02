"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, Plus, Pencil, Trash2, Lock, Loader2 } from "lucide-react";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { CardToolbar } from "@/components/shared/CardToolbar";
import { Pagination } from "@/components/shared/Pagination";
import { RoleDialog } from "@/components/roles/RoleDialog";
import { DeleteRoleDialog } from "@/components/roles/DeleteRoleDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { HRMS_MODULES, MODULE_LABELS, type Role } from "@/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

function countEnabledModules(role: Role): number {
  return HRMS_MODULES.filter((mod) => {
    const p = role.permissions?.[mod];
    return p && Object.values(p).some(Boolean);
  }).length;
}

export default function RolesPage() {
  const { hasPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Role | null>(null);

  const query = useTableQuery({ defaultSortBy: "roleName", defaultSortOrder: "asc", defaultLimit: 12 });
  const { data, isLoading } = useRoles(query.params);
  const roles = data?.data ?? [];

  const canCreate = hasPermission("roles", "create");
  const canEdit = hasPermission("roles", "edit");
  const canDelete = hasPermission("roles", "delete");

  const openCreate = () => {
    setSelected(null);
    setDialogOpen(true);
  };
  const openEdit = (role: Role) => {
    setSelected(role);
    setDialogOpen(true);
  };
  const openDelete = (role: Role) => {
    setSelected(role);
    setDeleteOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        description="Define roles and control access to each module."
        icon={Shield}
        action={
          canCreate && (
            <Button onClick={openCreate} className="shadow-sm">
              <Plus className="h-4 w-4" />
              Add Role
            </Button>
          )
        }
      />

      <CardToolbar query={query} placeholder="Search roles…" />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {roles.map((role) => {
            const enabled = countEnabledModules(role);
            const isSuperAdmin = role.isSystemRole && role.roleName === "Super Admin";
            return (
              <motion.div key={role._id} variants={item}>
                <Card className="group flex h-full flex-col p-5 transition-shadow hover:shadow-lg">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                      <Shield className="h-5 w-5" />
                    </div>
                    {role.isSystemRole && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Lock className="h-3 w-3" />
                        System
                      </Badge>
                    )}
                  </div>

                  <h3 className="text-base font-semibold">{role.roleName}</h3>
                  <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                    {role.description || "No description provided."}
                  </p>

                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{enabled}</span>
                    of {HRMS_MODULES.length} modules enabled
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {HRMS_MODULES.filter((mod) => {
                      const p = role.permissions?.[mod];
                      return p && Object.values(p).some(Boolean);
                    })
                      .slice(0, 4)
                      .map((mod) => (
                        <span
                          key={mod}
                          className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {MODULE_LABELS[mod]}
                        </span>
                      ))}
                    {enabled > 4 && (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        +{enabled - 4} more
                      </span>
                    )}
                  </div>

                  {(canEdit || canDelete) && (
                    <div className="mt-4 flex gap-2 border-t border-border pt-4">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => openEdit(role)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                      {canDelete && !isSuperAdmin && !role.isSystemRole && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/5 hover:text-destructive"
                          onClick={() => openDelete(role)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {!isLoading && data?.pagination && data.pagination.total > 0 && (
        <Card className="mt-4 overflow-hidden">
          <Pagination pagination={data.pagination} page={query.page} limit={query.limit} onPageChange={query.setPage} onLimitChange={query.setLimit} label="roles" />
        </Card>
      )}

      <RoleDialog open={dialogOpen} onOpenChange={setDialogOpen} role={selected} />
      <DeleteRoleDialog open={deleteOpen} onOpenChange={setDeleteOpen} role={selected} />
    </div>
  );
}
