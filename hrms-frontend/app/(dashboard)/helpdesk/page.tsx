"use client";
import { useState } from "react";
import { LifeBuoy, Plus, Loader2, ListChecks, Trash2 } from "lucide-react";
import { useMyTickets, useTickets, useDeleteTicket } from "@/hooks/useHelpdesk";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { NewTicketDialog } from "@/components/helpdesk/NewTicketDialog";
import { TicketDialog } from "@/components/helpdesk/TicketDialog";
import { cn } from "@/lib/utils";
import {
  HELPDESK_CATEGORY_LABELS, HELPDESK_STATUS_LABELS, type HelpdeskTicket, type HelpdeskStatus,
} from "@/types";

const statusStyles: Record<HelpdeskStatus, string> = {
  open: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  in_progress: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  closed: "bg-muted text-muted-foreground border-border",
};
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
const nameOf = (v: HelpdeskTicket["assignedTo"]) => (v && typeof v === "object" ? v.name : null);

export default function HelpdeskPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("helpdesk", "view");
  const canDelete = hasPermission("helpdesk", "delete");

  const { data: mine, isLoading: mineLoading } = useMyTickets();
  const { data: all, isLoading: allLoading } = useTickets({ limit: "200" }, { enabled: canView });
  const { mutate: remove, isPending: deleting } = useDeleteTicket();

  const [newOpen, setNewOpen] = useState(false);
  const [viewTicketId, setViewTicketId] = useState<string | null>(null);
  const [manageTicketId, setManageTicketId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HelpdeskTicket | null>(null);
  // Derived (not snapshotted) so the open dialog reflects new comments/status/assignment
  // as soon as the underlying query refetches, instead of showing stale data until reopened.
  const viewTicket = mine?.find((t) => t._id === viewTicketId) ?? null;
  const manageTicket = all?.data.find((t) => t._id === manageTicketId) ?? null;

  const [tab, setTab] = useState("mine");
  const tabs = [
    { key: "mine", label: "My Tickets", icon: LifeBuoy },
    canView && { key: "manage", label: "Manage", icon: ListChecks },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "mine";

  return (
    <div>
      <PageHeader
        title="Helpdesk"
        description="Raise a support ticket and track it through to resolution."
        icon={LifeBuoy}
        action={<Button onClick={() => setNewOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />New Ticket</Button>}
      />

      {tabs.length > 1 && <Tabs tabs={tabs} value={activeTab} onChange={setTab} />}

      {activeTab === "mine" && (
        mineLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !mine?.length ? (
          <Card className="p-16 text-center text-muted-foreground">
            <LifeBuoy className="mx-auto mb-2 h-7 w-7" />No tickets yet — raise one if you need help.
          </Card>
        ) : (
          <div className="space-y-3">
            {mine.map((t) => (
              <Card key={t._id} className="cursor-pointer p-4 transition-colors hover:bg-muted/30" onClick={() => setViewTicketId(t._id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{t.subject}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{HELPDESK_CATEGORY_LABELS[t.category]}</Badge>
                      <span>{fmtDate(t.createdAt)}</span>
                      {nameOf(t.assignedTo) && <span>· Assigned to {nameOf(t.assignedTo)}</span>}
                      {t.comments.length > 0 && <span>· {t.comments.length} comment{t.comments.length === 1 ? "" : "s"}</span>}
                    </div>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[t.status])}>{HELPDESK_STATUS_LABELS[t.status]}</span>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {activeTab === "manage" && (!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to the helpdesk queue.</Card>
      ) : allLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !all?.data.length ? (
        <Card className="p-16 text-center text-muted-foreground">
          <LifeBuoy className="mx-auto mb-2 h-7 w-7" />No tickets yet.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Raised by</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Assignee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {all.data.map((t) => {
                  const raiser = t.createdBy && typeof t.createdBy === "object" ? t.createdBy.name : "—";
                  return (
                    <tr key={t._id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30" onClick={() => setManageTicketId(t._id)}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{t.subject}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(t.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3">{raiser}</td>
                      <td className="px-4 py-3">{HELPDESK_CATEGORY_LABELS[t.category]}</td>
                      <td className="px-4 py-3">{nameOf(t.assignedTo) ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[t.status])}>{HELPDESK_STATUS_LABELS[t.status]}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canDelete && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <NewTicketDialog open={newOpen} onOpenChange={setNewOpen} />
      <TicketDialog open={!!viewTicketId} onOpenChange={(o) => !o && setViewTicketId(null)} ticket={viewTicket} canManage={false} />
      <TicketDialog open={!!manageTicketId} onOpenChange={(o) => !o && setManageTicketId(null)} ticket={manageTicket} canManage />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete ticket" description="This ticket and its comment thread will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
