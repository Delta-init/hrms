"use client";
import { Loader2, Users } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { useProgramRegistrations } from "@/hooks/usePrograms";
import { getInitials } from "@/lib/utils";
import type { Program } from "@/types";

/**
 * Who is actually going.
 *
 * A count answers "is it full"; a manager standing in front of the room needs
 * the names. Read separately rather than carried on every program in the list —
 * a page of twenty programs would otherwise fetch twenty registers to show
 * twenty numbers.
 */
export function ProgramRegisterDialog({
  program, onOpenChange,
}: { program: Program | null; onOpenChange: (open: boolean) => void }) {
  const { data: rows = [], isLoading } = useProgramRegistrations(program?._id ?? null);

  return (
    <ResponsiveDialog open={!!program} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Who is registered</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {program?.title}
            {program && program.capacity > 0 ? ` · ${program.seatsTaken} of ${program.capacity} places taken` : ""}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="max-h-[min(24rem,55vh)] overflow-y-auto px-4 pb-4 sm:px-0">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center">
              <Users className="mx-auto h-6 w-6 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">Nobody has registered yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const u = typeof r.user === "object" ? r.user : null;
                return (
                  <li key={r._id} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold">
                      {getInitials(u?.name ?? "?")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u?.name ?? "Unknown"}</p>
                      {u?.email && <p className="truncate text-xs text-muted-foreground">{u.email}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
