"use client";
import { Loader2, UserX } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteUser } from "@/hooks/useUsers";
import type { User } from "@/types";

interface DeleteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
}

/**
 * Deactivating an account, which is what deleting one now does.
 *
 * The wording matters more than usual here. This used to destroy the row and
 * say "cannot be undone", which was true and is the reason recovering one
 * meant rebuilding it by hand from migration spreadsheets. It now sets the
 * account inactive and keeps everything, so the dialog says that instead —
 * promising permanence the system no longer delivers would make people hesitate
 * over something safe, and, worse, teach them the warning is decorative.
 */
export function DeleteUserDialog({ open, onOpenChange, user }: DeleteUserDialogProps) {
  const { mutate: deleteUser, isPending } = useDeleteUser();

  const handleDelete = () => {
    if (!user) return;
    deleteUser(user._id, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 px-4 sm:px-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <UserX className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            </div>
            <ResponsiveDialogTitle>Deactivate User</ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className="pt-2 px-4 sm:px-0">
            <strong className="text-foreground">{user?.name}</strong> will not be able to sign in, and any
            session they have open ends immediately. Their attendance, leave and payslips are kept, and their
            employee record still points at the account.
            <span className="mt-2 block">
              You can switch them back to Active at any time by editing the user.
            </span>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Deactivate
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
