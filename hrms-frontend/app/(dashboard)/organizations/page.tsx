"use client";
import { useState } from "react";
import { Landmark, Plus, MoreHorizontal, Pencil, Trash2, Loader2, AlertTriangle, Mail } from "lucide-react";
import { useOrganizations, useDeleteOrganization } from "@/hooks/useOrganizations";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { OrganizationDialog } from "@/components/organizations/OrganizationDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Organization } from "@/types";

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
};

export default function OrganizationsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("organizations", "view");
  const canCreate = hasPermission("organizations", "create");
  const canEdit = hasPermission("organizations", "edit");
  const canDelete = hasPermission("organizations", "delete");

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useOrganizations(query.params, { enabled: canView });
  const { mutate: remove, isPending: deleting } = useDeleteOrganization();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Organization | null>(null);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Organizations" description="Manage tenants, their credentials and default settings." icon={Landmark} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to organizations.</Card>
      </div>
    );
  }

  const columns: DataTableColumn<Organization>[] = [
    {
      id: "org", label: "Organization", alwaysVisible: true, sortKey: "name",
      render: (o) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Landmark className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="truncate font-medium">{o.name}</p>
            <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{o.code}</p>
          </div>
        </div>
      ),
    },
    { id: "currency", label: "Currency", render: (o) => <span className="text-muted-foreground">{o.settings?.currency || "—"}</span> },
    { id: "timeZone", label: "Time zone", defaultVisible: false, render: (o) => <span className="text-muted-foreground">{o.settings?.timeZone || "—"}</span> },
    {
      id: "smtp", label: "Email", render: (o) => (
        o.settings?.smtpHost
          ? <span className="inline-flex items-center gap-1 text-emerald-600"><Mail className="h-3.5 w-3.5" />Configured</span>
          : <span className="text-muted-foreground">Not set</span>
      ),
    },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (o) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[o.status] ?? statusStyles.inactive)}>{o.status}</span>,
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (o) => (
        (canEdit || canDelete) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && <DropdownMenuItem onClick={() => { setSelected(o); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
              {canDelete && <DropdownMenuItem onClick={() => { setSelected(o); setDeleteOpen(true); }} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Organizations"
        description="Manage tenants, their credentials and default settings."
        icon={Landmark}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />Add Organization</Button>}
      />

      <DataTable
        tableId="organizations"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(o) => o._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchPlaceholder="Search organizations…"
        rowLabel="organizations"
        emptyText="No organizations found."
      />

      <OrganizationDialog open={dialogOpen} onOpenChange={setDialogOpen} organization={selected} />

      <ResponsiveDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <div className="flex items-center gap-3 px-4 sm:px-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
              <ResponsiveDialogTitle>Delete Organization</ResponsiveDialogTitle>
            </div>
            <ResponsiveDialogDescription className="pt-2 px-4 sm:px-0">
              Are you sure you want to delete <strong className="text-foreground">{selected?.name}</strong>? Data belonging to this organization will be orphaned. This action cannot be undone.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Delete Organization
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
