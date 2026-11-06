"use client";
import { Loader2, Sprout } from "lucide-react";
import { useMyFirstDays } from "@/hooks/useFirstDays";
import { PageHeader } from "@/components/shared/PageHeader";
import { FirstDaysSteps } from "@/components/firstDays/FirstDaysSteps";
import { Card } from "@/components/ui/card";

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

/**
 * A new joiner's guide to their first days: what to do each day, what is done,
 * and what is waiting on someone else. Only people who joined after this went
 * live have one; everyone else is told so, plainly.
 */
export default function MyFirstDaysPage() {
  const { data, isLoading } = useMyFirstDays();

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Your first 15 days" icon={Sprout} />
        <Card className="p-16 text-center text-muted-foreground">There is no first-days guide for you — it is for people in their first fifteen days here.</Card>
      </div>
    );
  }

  const pct = Math.round((data.doneCount / data.totalCount) * 100);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Your first 15 days"
        description={data.redActive
          ? `Day ${data.day} of ${data.of} · ${fmtDay(data.startDay)} to ${fmtDay(data.endDay)}`
          : `Your first fifteen days ended on ${fmtDay(data.endDay)}.`}
        icon={Sprout}
      />
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{data.complete ? "All done — welcome aboard." : `${data.doneCount} of ${data.totalCount} steps done`}</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </Card>
      <FirstDaysSteps view={data} />
    </div>
  );
}
