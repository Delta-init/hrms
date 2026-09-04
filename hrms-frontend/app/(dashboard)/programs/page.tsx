"use client";
import { useState } from "react";
import { GraduationCap, Plus, Pencil, Trash2, Users, CalendarDays, Loader2, Inbox } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProgramCard } from "@/components/programs/ProgramCard";
import { ProgramDialog } from "@/components/programs/ProgramDialog";
import { ProgramRegisterDialog } from "@/components/programs/ProgramRegisterDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  usePrograms, useMyPrograms, useDeleteProgram, useRegisterForProgram, useCancelRegistration,
} from "@/hooks/usePrograms";
import { cn } from "@/lib/utils";
import { PROGRAM_STATUS_LABELS, type Program } from "@/types";

const TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  open: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  closed: "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400",
  cancelled: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
};

/**
 * One page for two audiences.
 *
 * Everybody sees what they can book, because that is what a member of staff
 * came here for. Whoever runs programs sees the same page with the full list
 * underneath — including drafts and past ones, which are invisible above.
 *
 * Not two routes, because "the programs page" is one idea, and splitting it
 * would mean a manager checking what their own staff can actually see has to
 * navigate somewhere else to find out.
 */
export default function ProgramsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("programs", "view");
  const canCreate = hasPermission("programs", "create");
  const canEdit = hasPermission("programs", "edit");
  const canDelete = hasPermission("programs", "delete");

  const { data: mine = [], isLoading: loadingMine } = useMyPrograms();
  const { data: all = [], isLoading: loadingAll } = usePrograms(undefined, canManage);
  const register = useRegisterForProgram();
  const cancel = useCancelRegistration();
  const { mutate: remove, isPending: removing } = useDeleteProgram();

  const [editing, setEditing] = useState<Program | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Program | null>(null);
  const [viewingRegister, setViewingRegister] = useState<Program | null>(null);
  /** Which card is mid-flight, so only that button spins. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = (id: string, fn: typeof register) => {
    setBusyId(id);
    fn.mutate(id, { onSettled: () => setBusyId(null) });
  };

  const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programs"
        description="Training, workshops and sessions you can put your name down for."
        icon={GraduationCap}
        action={
          canCreate ? (
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" />New program
            </Button>
          ) : undefined
        }
      />

      {/* What anybody can book. First, because it is why most people open this. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Open to you</h2>
        {loadingMine ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : mine.length === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="mx-auto h-7 w-7 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">Nothing open at the moment</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Programs appear here once they are published, and disappear once they have started.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((row) => (
              <ProgramCard
                key={row.program._id}
                row={row}
                pending={busyId === row.program._id}
                onRegister={() => act(row.program._id, register)}
                onCancel={() => act(row.program._id, cancel)}
                onViewRegister={() => setViewingRegister(row.program)}
              />
            ))}
          </div>
        )}
      </section>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">All programs</h2>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-semibold">Program</th>
                    <th className="px-5 py-3 font-semibold">When</th>
                    <th className="px-5 py-3 text-center font-semibold">Places</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingAll ? (
                    <tr><td colSpan={5} className="px-5 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                  ) : all.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">No programs yet.</td></tr>
                  ) : all.map((p) => {
                    const full = p.capacity > 0 && p.seatsTaken >= p.capacity;
                    return (
                      <tr key={p._id} className="hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <p className="font-medium">{p.title}</p>
                          {p.location && <p className="text-xs text-muted-foreground">{p.location}</p>}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{fmt.format(new Date(p.startsAt))}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {/* Taken over total, because a manager is asking how
                              full it is — the opposite question to the one the
                              card above answers for somebody deciding to book. */}
                          <button
                            type="button"
                            onClick={() => setViewingRegister(p)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs tabular-nums hover:bg-accent",
                              full && "font-semibold text-amber-600 dark:text-amber-400"
                            )}
                            title="See who is registered"
                          >
                            <Users className="h-3.5 w-3.5" />
                            {p.capacity > 0 ? `${p.seatsTaken} / ${p.capacity}` : `${p.seatsTaken} · no limit`}
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[p.status])}>
                            {PROGRAM_STATUS_LABELS[p.status]}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-0.5">
                            {canEdit && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleting(p)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      <ProgramDialog open={dialogOpen} onOpenChange={setDialogOpen} program={editing} />
      <ProgramRegisterDialog program={viewingRegister} onOpenChange={() => setViewingRegister(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete program"
        // Said plainly, because it is true: the register goes with it, and
        // unlike a payslip nothing downstream depends on those rows.
        description={
          deleting
            ? `"${deleting.title}" and its list of ${deleting.seatsTaken} registered ${deleting.seatsTaken === 1 ? "person" : "people"} will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        isPending={removing}
        onConfirm={() => { if (deleting) remove(deleting._id, { onSuccess: () => setDeleting(null) }); }}
      />
    </div>
  );
}
