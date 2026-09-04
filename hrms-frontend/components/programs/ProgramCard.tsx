"use client";
import { CalendarDays, MapPin, Users, Check, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProgramForUser } from "@/types";

/**
 * One bookable program, as a member of staff sees it.
 *
 * The seat count leads because it is the thing that decides whether to act now.
 * "3 places left" and "Full" are different messages from "12 of 15", which
 * reads as an inventory report and makes somebody do the subtraction.
 */
export function ProgramCard({
  row, onRegister, onCancel, onViewRegister, pending,
}: {
  row: ProgramForUser;
  onRegister: () => void;
  onCancel: () => void;
  onViewRegister: () => void;
  pending: boolean;
}) {
  const { program: p, registered, seatsLeft, full } = row;
  const when = new Date(p.startsAt);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

  // Nearly gone is worth saying differently from plenty left; a number alone
  // makes everybody work out which they are looking at.
  const scarce = seatsLeft !== null && seatsLeft > 0 && seatsLeft <= 3;

  return (
    <Card className={cn("flex flex-col overflow-hidden", registered && "border-primary/40 bg-primary/5")}>
      {/* Only when there is one. An empty grey box in its place makes every
          program without a banner look like it failed to load. */}
      {p.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="h-32 w-full object-cover" loading="lazy" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-snug">{p.title}</h3>
          {p.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
          )}
        </div>
        {registered && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <Check className="h-3 w-3" />Booked
          </span>
        )}
      </div>

      <dl className="grid gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span>{fmt.format(when)}</span>
        </div>
        {p.location && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{p.location}</span>
          </div>
        )}
        <button
          type="button"
          onClick={onViewRegister}
          className="flex items-center gap-1.5 hover:text-foreground"
          title="See who is registered"
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span
            className={cn(
              "underline decoration-dotted underline-offset-2",
              full && "font-semibold text-amber-600 dark:text-amber-400",
              scarce && "font-semibold text-amber-600 dark:text-amber-400"
            )}
          >
            {seatsLeft === null
              ? "No limit on places"
              : full
                ? "Full"
                : `${seatsLeft} place${seatsLeft === 1 ? "" : "s"} left`}
          </span>
        </button>
      </dl>

      <div className="mt-auto pt-1">
        {registered ? (
          <Button variant="outline" size="sm" className="w-full" disabled={pending} onClick={onCancel}>
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Give up my place
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full"
            // Full is a dead end rather than a button that fails: the server
            // refuses it either way, and offering the press teaches people the
            // count on the card is decorative.
            disabled={pending || full}
            onClick={onRegister}
          >
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {full ? "Full" : "Register"}
          </Button>
        )}
      </div>
      </div>
    </Card>
  );
}
