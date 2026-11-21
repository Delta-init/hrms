"use client";
import { useState } from "react";
import { Crown, Trophy, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDgoLeaderboard, formatPoints, dgoErrorMessage } from "@/hooks/useDgoPoints";
import { DgoGate, LeaderboardTabs, MonthSwitcher, Notice, Spinner, monthLabel } from "@/components/dgo/shared";
import type { DgoLeaderboardView, DgoMe } from "@/types";

const ALL = "__all__";
type Row = DgoLeaderboardView["rows"][number];

export default function DgoLeaderboardPage() {
  return (
    <DgoGate allow={(me) => me.canUse}>
      {(me) => <LeaderboardPage me={me} />}
    </DgoGate>
  );
}

function scopeText(d: DgoLeaderboardView) {
  if (d.scope === "own") return "Only your own rank is shown.";
  const picked = d.department ? d.departments.find((x) => x.id === d.department)?.name : null;
  if (picked) return picked;
  return d.scope === "department" ? "Your department" : "Everyone in the company";
}

function LeaderboardPage({ me }: { me: DgoMe }) {
  const thisMonth = me.today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [department, setDepartment] = useState("");
  const { data, isLoading, isFetching, error } = useDgoLeaderboard(month, department);

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        description="Who earned the most points this month."
        icon={Trophy}
        action={<MonthSwitcher month={month} onChange={setMonth} max={thisMonth} busy={isFetching && !isLoading} />}
      />
      <LeaderboardTabs active="points" />

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "The leaderboard couldn't be loaded. Try again in a moment.")} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" /> {scopeText(data)} · {monthLabel(data.month)}
            </p>
            {data.departments.length > 0 && (
              <Select value={department || ALL} onValueChange={(v) => setDepartment(v === ALL ? "" : v)}>
                <SelectTrigger className="h-9 w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{data.scope === "company" ? "All departments" : "All I can see"}</SelectItem>
                  {data.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {data.me && <MyLine me={data.me} />}

          {data.scope === "own" ? (
            <Notice icon={Trophy} text="HR shows the full ranking to managers only. Keep earning — your rank is above." />
          ) : data.rows.length === 0 ? (
            <Notice icon={Trophy} text="Nobody has earned points in this month yet." />
          ) : (
            <>
              <Podium rows={data.rows.filter((r) => r.rank <= 3).slice(0, 3)} />
              <Card>
                <ol className="divide-y divide-border">
                  {data.rows.map((r) => <RankRow key={r.employeeId} r={r} />)}
                </ol>
              </Card>
            </>
          )}
          <p className="text-xs text-muted-foreground">{data.note}</p>
        </div>
      )}
    </div>
  );
}

function MyLine({ me }: { me: NonNullable<DgoLeaderboardView["me"]> }) {
  return (
    <Card className="flex items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4">
      <div>
        <p className="text-xs text-muted-foreground">Your rank</p>
        <p className="text-2xl font-bold tabular-nums">{me.rank ? `#${me.rank}` : "—"}<span className="ml-1 text-sm font-normal text-muted-foreground">{me.rank ? `of ${me.of}` : "Earn points to get a rank"}</span></p>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Your points</p>
        <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatPoints(me.points)}</p>
      </div>
    </Card>
  );
}

const MEDAL = [
  "from-amber-300 to-amber-500 text-amber-950",   // gold
  "from-slate-200 to-slate-400 text-slate-900",   // silver
  "from-orange-300 to-orange-500 text-orange-950", // bronze
];

/** First, second and third — shared ranks share a colour. Second sits left of first, third right. */
function Podium({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  const order = rows.length >= 3 ? [rows[1], rows[0], rows[2]] : rows.length === 2 ? [rows[1], rows[0]] : [rows[0]];
  return (
    <div className={cn("grid items-end gap-3", order.length === 3 ? "grid-cols-3" : order.length === 2 ? "grid-cols-2" : "grid-cols-1 sm:mx-auto sm:max-w-xs")}>
      {order.map((r) => {
        const tone = MEDAL[Math.min(2, r.rank - 1)];
        const tall = r.rank === 1;
        return (
          <Card key={r.employeeId} className={cn("flex flex-col items-center gap-2 p-3 text-center sm:p-4", tall && "sm:pb-8", r.me && "ring-2 ring-primary")}>
            <div className="relative">
              {r.rank === 1 && <Crown className="absolute -top-4 left-1/2 h-5 w-5 -translate-x-1/2 text-amber-500" />}
              <PersonAvatar name={r.name} photoUrl={r.photoUrl} className={cn(tall ? "h-16 w-16" : "h-12 w-12")} />
              <span className={cn("absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold shadow", tone)}>{r.rank}</span>
            </div>
            <p className="line-clamp-2 text-sm font-semibold leading-tight">{r.name}</p>
            {r.department && <p className="hidden text-xs text-muted-foreground sm:block">{r.department}</p>}
            <p className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatPoints(r.points)}</p>
          </Card>
        );
      })}
    </div>
  );
}

function RankRow({ r }: { r: Row }) {
  return (
    <li className={cn("flex items-center gap-3 px-4 py-2.5", r.me && "bg-primary/5")}>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
          r.rank <= 3 ? cn("bg-gradient-to-br", MEDAL[r.rank - 1]) : "text-muted-foreground",
        )}
        aria-label={`Rank ${r.rank}`}
      >
        {r.rank}
      </span>
      <PersonAvatar name={r.name} photoUrl={r.photoUrl} className="h-8 w-8" fallbackClassName="text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{r.name}{r.me && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">You</span>}</p>
        {r.department && <p className="truncate text-xs text-muted-foreground">{r.department}</p>}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPoints(r.points)} <span className="text-xs font-normal text-muted-foreground">pts</span></span>
    </li>
  );
}
