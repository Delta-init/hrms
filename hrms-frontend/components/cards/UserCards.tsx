"use client";
import { useState } from "react";
import { CreditCard, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useCards, useDeleteCard } from "@/hooks/useCards";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card as UICard } from "@/components/ui/card";
import { CardDialog } from "@/components/cards/CardDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import { CARD_STATUS_LABELS, type Card, type CardStatus } from "@/types";

const statusStyles: Record<CardStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  expired: "bg-red-500/10 text-red-600 border-red-500/20",
};
const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");

/** Cards issued to one client (user) — add / edit / delete inline. */
export function UserCards({ userId }: { userId: string }) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("cards", "create");
  const canEdit = hasPermission("cards", "edit");
  const canDelete = hasPermission("cards", "delete");

  const { data, isLoading } = useCards({ client: userId, limit: "100", sortBy: "createdAt", sortOrder: "desc" });
  const cards = data?.data ?? [];
  const { mutate: remove, isPending: deleting } = useDeleteCard();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Card | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Cards</h3>
          <p className="text-xs text-muted-foreground">Cards issued to this user.</p>
        </div>
        {canCreate && <Button size="sm" onClick={() => { setSelected(null); setDialogOpen(true); }}><Plus className="h-4 w-4" />New Card</Button>}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : cards.length === 0 ? (
        <UICard className="p-12 text-center text-sm text-muted-foreground">No cards issued to this user yet.</UICard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <UICard key={c._id} className="overflow-hidden">
              {/* Card face */}
              <div className="relative bg-gradient-to-br from-primary via-indigo-600 to-indigo-800 p-4 text-white">
                <div className="flex items-start justify-between">
                  <CreditCard className="h-6 w-6 opacity-90" />
                  <span className={cn("rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[10px] font-medium capitalize backdrop-blur")}>{CARD_STATUS_LABELS[c.status ?? "active"]}</span>
                </div>
                <p className="mt-5 font-mono text-lg tracking-wider">{c.cardNumber}</p>
                <div className="mt-2 flex items-end justify-between text-xs">
                  <div><p className="text-white/60">Name</p><p className="font-medium">{c.name}</p></div>
                  <div className="text-right"><p className="text-white/60">Expires</p><p className="font-medium">{fmtDate(c.expiryDate)}</p></div>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Issued {fmtDate(c.issueDate)}</span>
                <div className="flex items-center gap-1">
                  {canEdit && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelected(c); setDialogOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                  {canDelete && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(c)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
            </UICard>
          ))}
        </div>
      )}

      <CardDialog open={dialogOpen} onOpenChange={setDialogOpen} card={selected} lockClientId={userId} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete card" description="This card will be permanently removed."
        isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
