"use client";
import { useState } from "react";
import { Megaphone, Plus, Pencil, Trash2, Loader2, Pin } from "lucide-react";
import { useAnnouncements, useDeleteAnnouncement } from "@/hooks/useAnnouncements";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { AnnouncementDialog } from "@/components/announcements/AnnouncementDialog";
import { getInitials, cn } from "@/lib/utils";
import { ANNOUNCEMENT_CATEGORY_LABELS, type Announcement, type AnnouncementCategory } from "@/types";

const categoryStyles: Record<AnnouncementCategory, string> = {
  general: "bg-muted text-muted-foreground border-border",
  policy: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  event: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  celebration: "bg-pink-500/10 text-pink-600 border-pink-500/20",
};
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
const authorOf = (a: Announcement) => (a.createdBy && typeof a.createdBy === "object" ? a.createdBy.name : null);

export default function AnnouncementsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("announcements", "view");
  const canCreate = hasPermission("announcements", "create");
  const canEdit = hasPermission("announcements", "edit");
  const canDelete = hasPermission("announcements", "delete");

  const { data, isLoading } = useAnnouncements({ limit: "100" }, { enabled: canView });
  const rows = data?.data ?? [];
  const { mutate: remove, isPending: deleting } = useDeleteAnnouncement();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Org-wide news and updates, visible to everyone."
        icon={Megaphone}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Announcement</Button>}
      />

      {!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to announcements.</Card>
      ) : isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground">
          <Megaphone className="mx-auto mb-2 h-7 w-7" />
          No announcements yet.
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <Card key={a._id} className="group p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    <h3 className="font-semibold">{a.title}</h3>
                    <Badge variant="outline" className={cn("capitalize", categoryStyles[a.category])}>{ANNOUNCEMENT_CATEGORY_LABELS[a.category]}</Badge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    {authorOf(a) && (
                      <span className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{getInitials(authorOf(a)!)}</span>
                        {authorOf(a)}
                      </span>
                    )}
                    <span>·</span>
                    <span>{fmtDate(a.createdAt)}</span>
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(a); setDialogOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                    {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(a)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <AnnouncementDialog open={dialogOpen} onOpenChange={setDialogOpen} announcement={selected} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete announcement" description="This announcement will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
