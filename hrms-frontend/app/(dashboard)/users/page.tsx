"use client";
import { useState } from "react";
import Link from "next/link";
import { Users, Plus, MoreHorizontal, Pencil, Trash2, Eye, ContactRound } from "lucide-react";
import { useUsers } from "@/hooks/useUsers";
import { useRolesSimple } from "@/hooks/useRoles";
import { useAuth, useImpersonate } from "@/hooks/useAuth";
import { toast } from "@/lib/toast";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { UserDialog } from "@/components/users/UserDialog";
import { DeleteUserDialog } from "@/components/users/DeleteUserDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import type { User } from "@/types";

const ALL = "__all__";
const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  invited: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

export default function UsersPage() {
  const { user: me, hasPermission } = useAuth();
  const canView = hasPermission("users", "view");
  const canCreate = hasPermission("users", "create");
  const canEdit = hasPermission("users", "edit");
  const canDelete = hasPermission("users", "delete");
  const impersonate = useImpersonate();

  const doImpersonate = async (id: string) => {
    try { await impersonate(id); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not impersonate"); }
  };

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useUsers(query.params, { enabled: canView });
  const { data: roles = [] } = useRolesSimple();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Users" description="Create staff accounts and manage their roles & access." icon={Users} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to users.</Card>
      </div>
    );
  }

  const columns: DataTableColumn<User>[] = [
    {
      id: "user", label: "User", alwaysVisible: true, sortKey: "name",
      render: (u) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(u.name)}</div>
          <div className="min-w-0">
            <Link href={`/users/${u._id}`} className="block truncate font-medium hover:text-primary hover:underline">{u.name}</Link>
            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
          </div>
        </div>
      ),
    },
    { id: "role", label: "Role", render: (u) => <Badge variant="secondary" className="font-medium">{typeof u.role === "object" ? u.role.roleName : "—"}</Badge> },
    { id: "designation", label: "Designation", render: (u) => <span className="text-muted-foreground">{u.designation || "—"}</span> },
    { id: "workSchedule", label: "Work Schedule", defaultVisible: false, render: (u) => <span className="text-muted-foreground">{typeof u.workSchedule === "object" && u.workSchedule ? u.workSchedule.name : "—"}</span> },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (u) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[u.status] ?? statusStyles.inactive)}>{u.status}</span>,
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild className="cursor-pointer"><Link href={`/users/${u._id}`}><ContactRound className="mr-2 h-4 w-4" />Open profile &amp; cards</Link></DropdownMenuItem>
            {canEdit && <DropdownMenuItem onClick={() => { setSelected(u); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit user</DropdownMenuItem>}
            {canEdit && u._id !== me?._id && !(typeof u.role === "object" && u.role.isSystemRole) && (
              <DropdownMenuItem onClick={() => doImpersonate(u._id)} className="cursor-pointer"><Eye className="mr-2 h-4 w-4" />Impersonate</DropdownMenuItem>
            )}
            {canDelete && <DropdownMenuItem onClick={() => { setSelected(u); setDeleteOpen(true); }} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filters = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Role</Label>
        <Select value={query.filters.role ?? ALL} onValueChange={(v) => query.setFilter("role", v)}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            {roles.map((r) => <SelectItem key={r._id} value={r._id}>{r.roleName}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Users"
        description="Create staff accounts and manage their roles & access."
        icon={Users}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />Add User</Button>}
      />

      <DataTable
        tableId="users"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(u) => u._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchPlaceholder="Search users…"
        filters={filters}
        rowLabel="users"
        emptyText="No users found."
      />

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} user={selected} />
      <DeleteUserDialog open={deleteOpen} onOpenChange={setDeleteOpen} user={selected} />
    </div>
  );
}
