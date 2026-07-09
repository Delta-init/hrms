"use client";
import { useState } from "react";
import { CreditCard, Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useCards, useDeleteCard } from "@/hooks/useCards";
import { useUsers } from "@/hooks/useUsers";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { CardDialog } from "@/components/cards/CardDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { CARD_STATUS_LABELS, type Card, type CardStatus } from "@/types";

const ALL = "__all__";
const statusStyles: Record<CardStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  expired: "bg-red-500/10 text-red-600 border-red-500/20",
};
const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const clientOf = (c: Card) => (c.client && typeof c.client === "object" ? c.client.name : "—");

export default function CardsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("cards", "create");
  const canEdit = hasPermission("cards", "edit");
  const canDelete = hasPermission("cards", "delete");

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useCards(query.params);
  const { data: usersData } = useUsers({ limit: "200" });
  const users = usersData?.data ?? [];
  const { mutate: remove, isPending: deleting } = useDeleteCard();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Card | null>(null);

  const columns: DataTableColumn<Card>[] = [
    {
      id: "cardNumber", label: "Card Number", alwaysVisible: true, sortKey: "cardNumber",
      render: (c) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-indigo-700 text-primary-foreground"><CreditCard className="h-4 w-4" /></div>
          <span className="font-mono text-sm font-medium">{c.cardNumber}</span>
        </div>
      ),
    },
    { id: "name", label: "Name on Card", sortKey: "name", render: (c) => <span className="font-medium">{c.name}</span> },
    {
      id: "client", label: "Client",
      render: (c) => (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{getInitials(clientOf(c))}</div>
          <span className="text-muted-foreground">{clientOf(c)}</span>
        </div>
      ),
    },
    { id: "issueDate", label: "Issued", sortKey: "issueDate", render: (c) => <span className="text-muted-foreground">{fmtDate(c.issueDate)}</span> },
    { id: "expiryDate", label: "Expires", sortKey: "expiryDate", render: (c) => <span className="text-muted-foreground">{fmtDate(c.expiryDate)}</span> },
    { id: "status", label: "Status", render: (c) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[c.status ?? "active"])}>{CARD_STATUS_LABELS[c.status ?? "active"]}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (c) => (canEdit || canDelete) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && <DropdownMenuItem onClick={() => { setSelected(c); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem onClick={() => { setSelected(c); setDeleteOpen(true); }} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    },
  ];

  const filters = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Client</Label>
        <Select value={query.filters.client ?? ALL} onValueChange={(v) => query.setFilter("client", v)}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All clients" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All clients</SelectItem>{users.map((u) => <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All status</SelectItem>{(["active", "expired"] as CardStatus[]).map((s) => <SelectItem key={s} value={s}>{CARD_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Cards"
        description="Issue and manage cards linked to clients."
        icon={CreditCard}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Card</Button>}
      />

      <DataTable
        tableId="cards" columns={columns} rows={data?.data ?? []} rowKey={(c) => c._id}
        loading={isLoading || isFetching} pagination={data?.pagination} query={query}
        filters={filters} searchPlaceholder="Search card number or name…" rowLabel="cards"
        emptyText="No cards yet." minWidth={820} exportName="cards"
        exportMapper={(c) => ({ "Card Number": c.cardNumber, Name: c.name, Client: clientOf(c), Issued: fmtDate(c.issueDate), Expires: fmtDate(c.expiryDate), Status: CARD_STATUS_LABELS[c.status ?? "active"] })}
      />

      <CardDialog open={dialogOpen} onOpenChange={setDialogOpen} card={selected} />
      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title="Delete card" description="This card will be permanently removed."
        isPending={deleting}
        onConfirm={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })}
      />
    </div>
  );
}
