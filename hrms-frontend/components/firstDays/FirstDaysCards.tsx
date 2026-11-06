"use client";
import Link from "next/link";
import { ArrowRight, Sprout, Users } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAuth } from "@/hooks/useAuth";
import { useMyFirstDays, useTeamFirstDays } from "@/hooks/useFirstDays";
import { actionsFor } from "@/components/firstDays/FirstDaysSteps";
import { Card } from "@/components/ui/card";

/**
 * On the dashboard: for a new joiner, what is next in their guide; for a
 * department head or HR, the new joiners waiting on them. Nothing at all for
 * everyone else, which is almost everyone.
 */
export function FirstDaysCards() {
  const { status } = useSession();
  const { isKioskOnly } = useAuth();
  const enabled = status === "authenticated" && !isKioskOnly;
  const { data: mine } = useMyFirstDays(enabled);
  const { data: team = [] } = useTeamFirstDays(enabled);

  const next = mine?.steps.find((s) => s.status === "overdue" || s.status === "todo");
  const waiting = team.reduce((n, v) => n + actionsFor(v), 0);

  return (
    <>
      {mine && (mine.redActive || !mine.complete) && (
        <Link href="/first-days" className="block">
          <Card className="flex items-center gap-4 border-primary/30 p-5 transition-colors hover:bg-muted/40">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sprout className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Your first 15 days{mine.redActive ? ` · Day ${mine.day} of ${mine.of}` : ""}</p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {mine.complete ? "Every step is done." : next ? `Next: ${next.title}` : "Nothing to do right now — the next step opens later."}
                {` · ${mine.doneCount} of ${mine.totalCount} done`}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Card>
        </Link>
      )}
      {team.length > 0 && (
        <Link href="/first-days/team" className="block">
          <Card className="flex items-center gap-4 p-5 transition-colors hover:bg-muted/40">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Users className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">New joiners · {team.length}</p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {waiting ? `${waiting} step${waiting === 1 ? "" : "s"} waiting on you` : "Nothing waiting on you"}
                {" · "}{team.slice(0, 3).map((v) => `${v.employee.name} (day ${v.day})`).join(", ")}{team.length > 3 ? "…" : ""}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Card>
        </Link>
      )}
    </>
  );
}
