"use client";
import Link from "next/link";
import { ArrowUpRight, ListTodo } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useMyTaskSummary } from "@/hooks/useTasks";

/**
 * The dashboard's "your tasks" line (2026-11-25). Shown only while something is open — an empty card every day
 * teaches people to skip it.
 */
export function MyTasksCard() {
  const { data } = useMyTaskSummary();
  if (!data || !data.open) return null;
  const bits = [
    data.sentBack ? { n: data.sentBack, label: "sent back", tone: "bad" } : null,
    data.overdue ? { n: data.overdue, label: "overdue", tone: "bad" } : null,
    data.dueToday ? { n: data.dueToday, label: "due today", tone: "warn" } : null,
  ].filter(Boolean) as Array<{ n: number; label: string; tone: string }>;
  return (
    <Link href="/tasks" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="flex items-center gap-4 p-4 transition-colors hover:border-primary/40">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ListTodo className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Your tasks</p>
          <p className="text-sm text-muted-foreground">
            {data.open} open{bits.map((b) => (
              <span key={b.label}> · <span className={cn("font-medium", b.tone === "bad" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>{b.n} {b.label}</span></span>
            ))}
          </p>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    </Link>
  );
}
