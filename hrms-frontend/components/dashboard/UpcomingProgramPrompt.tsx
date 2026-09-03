"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, CalendarDays, MapPin, Users, Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useMyPrograms, useRegisterForProgram } from "@/hooks/usePrograms";
import { cn } from "@/lib/utils";

/**
 * The next program somebody could book, put in front of them on arrival.
 *
 * A program with places is only useful while it still has them, and a link in a
 * sidebar is not how anybody discovers that. It opens once, for the soonest
 * unbooked program, and then stays shut.
 *
 * Shut until tomorrow, specifically — the same rule the face-enrolment prompt
 * beside it uses. A dialog that reappears on every navigation is one people
 * learn to dismiss without reading, which costs the next one its audience too.
 * Dismissal is remembered per program, so a new one still gets its moment.
 *
 * Nothing to show is the normal state: no open programs, or already booked onto
 * all of them. It renders nothing rather than an empty dialog.
 */
const KEY = "hrms.program-prompt";

/** Read the "seen" map, tolerating storage that refuses or holds nonsense. */
function seenMap(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function UpcomingProgramPrompt() {
  const router = useRouter();
  const { data: rows = [] } = useMyPrograms();
  const register = useRegisterForProgram();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  // The soonest one they have not booked and that still has room. Sorted by the
  // server, so the first match is the next thing worth telling them about.
  const next = rows.find((r) => !r.registered && !r.full)?.program ?? null;

  useEffect(() => {
    if (!next || shown === next._id) return;
    const until = seenMap()[next._id] ?? 0;
    if (Date.now() < until) return;
    setShown(next._id);
    setOpen(true);
  }, [next, shown]);

  const dismiss = () => {
    setOpen(false);
    if (!next) return;
    try {
      // Until midnight, so it can come back tomorrow while there is still time
      // to book — but not again this afternoon.
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      window.localStorage.setItem(KEY, JSON.stringify({ ...seenMap(), [next._id]: midnight.getTime() }));
    } catch {
      /* storage refused — it simply asks again next time */
    }
  };

  if (!next) return null;

  const when = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(next.startsAt));
  const left = next.capacity ? Math.max(0, next.capacity - next.seatsTaken) : null;
  const scarce = left !== null && left <= 3;

  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 px-4 sm:px-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <ResponsiveDialogTitle>{next.title}</ResponsiveDialogTitle>
          </div>
          {next.description && (
            <ResponsiveDialogDescription className="px-4 pt-2 sm:px-0">
              {next.description}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        <dl className="space-y-2 px-4 pb-2 text-sm sm:px-0">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" /><span>{when}</span>
          </div>
          {next.location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" /><span>{next.location}</span>
            </div>
          )}
          <div className={cn("flex items-center gap-2", scarce ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            <Users className="h-4 w-4 shrink-0" />
            <span>{left === null ? "No limit on places" : `${left} place${left === 1 ? "" : "s"} left`}</span>
          </div>
        </dl>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={dismiss} disabled={register.isPending}>
            Not now
          </Button>
          {/* Booking from here rather than sending them to the page: the whole
              point is that the place is still available at this moment. */}
          <Button
            disabled={register.isPending}
            onClick={() =>
              register.mutate(next._id, {
                onSuccess: () => setOpen(false),
                // A refusal — somebody took the last place in the meantime — is
                // already a toast. Sending them to the page lets them see what
                // else is open rather than leaving them at a dead dialog.
                onError: () => { setOpen(false); router.push("/programs"); },
              })
            }
          >
            {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
