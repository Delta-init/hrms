"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Clock, Coins, Gem, Gift, Hourglass, Trophy, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDgoDashboard, formatAed, formatPoints, dgoErrorMessage } from "@/hooks/useDgoPoints";
import {
  DgoGate, LedgerPoints, LedgerTypeChip, MonthSwitcher, Notice, Spinner, Stat, StatusPill, TableWrap, UsageBar,
  STAGE_LABEL, shortDay, dayLabel,
} from "@/components/dgo/shared";
import type { DgoDashboard, DgoMe } from "@/types";

export default function DgoOverviewPage() {
  return (
    <DgoGate allow={(me) => me.canUse}>
      {(me) => <Overview me={me} />}
    </DgoGate>
  );
}

function Overview({ me }: { me: DgoMe }) {
  const thisMonth = me.today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data, isLoading, isFetching, error } = useDgoDashboard(month);

  return (
    <div>
      <PageHeader
        title="DGO Points"
        description={`Points for verified work and recognition. 1 point = ${formatAed(me.pointValueAed)}.`}
        icon={Gem}
        action={<MonthSwitcher month={month} onChange={setMonth} max={thisMonth} busy={isFetching && !isLoading} />}
      />
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "Your points couldn't be loaded. Try again in a moment.")} />
      ) : (
        <div className="space-y-6">
          {data.own ? <Own d={data} own={data.own} isThisMonth={month === thisMonth} /> : (
            <Notice text="Your login isn't linked to an employee record, so there are no points of your own to show." />
          )}
          {data.team && <Team d={data} />}
          {data.company && <Company d={data} />}
        </div>
      )}
    </div>
  );
}

function Own({ d, own, isThisMonth }: { d: DgoDashboard; own: NonNullable<DgoDashboard["own"]>; isThisMonth: boolean }) {
  const b = own.balances;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Available points"
          value={formatPoints(b.available)}
          sub={`= ${formatAed(own.availableAed)}${b.reserved ? ` · ${formatPoints(b.reserved)} held for rewards` : ""}`}
          tone="gold"
          icon={Coins}
        />
        <Stat label="Earned this month" value={`+${formatPoints(own.monthEarned)}`} sub={b.pending ? `${formatPoints(b.pending)} waiting for approval` : "Nothing waiting"} icon={Gem} />
        <Stat
          label="Your rank this month"
          value={own.rank ? `#${own.rank.position}` : "—"}
          sub={own.rank ? `of ${own.rank.of} earning points` : "Earn points to get a rank"}
          icon={Trophy}
        />
        <Stat
          label="Next to expire"
          value={own.nextExpiry ? formatPoints(own.nextExpiry.points) : "—"}
          sub={own.nextExpiry ? `on ${dayLabel(own.nextExpiry.on)}` : "Nothing expiring"}
          icon={Hourglass}
        />
      </div>

      <Link
        href="/dgo-points/rewards"
        className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm transition-colors hover:bg-amber-500/10"
      >
        <span className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="font-medium">Spend your points</span>
          <span className="hidden text-muted-foreground sm:inline">— see what {formatPoints(b.available)} points can get you in the store.</span>
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Today</p>
            <span className="text-xs text-muted-foreground">{shortDay(own.today.day)}</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs"><span>Daily cap used</span><span className="tabular-nums font-medium">{own.today.used} / {own.today.cap} pts</span></div>
            <UsageBar used={own.today.used} of={own.today.cap} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs"><span>KPI points</span><span className="tabular-nums font-medium">{own.today.autoUsed} / {own.today.autoCap} pts</span></div>
            <UsageBar used={own.today.autoUsed} of={own.today.autoCap} />
          </div>
          <p className="text-xs text-muted-foreground">Innovation awards don&apos;t count towards the daily cap.</p>
        </Card>
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">Your department&apos;s budget{isThisMonth ? " this month" : ""}</p>
          {own.department ? (
            <>
              <div className="flex justify-between text-xs">
                <span>{own.department.name} · {own.department.group === "revenue" ? "revenue" : "other"} group</span>
                <span className="tabular-nums font-medium">{formatAed(own.department.committedAed)} of {formatAed(own.department.allocationAed)}</span>
              </div>
              <UsageBar used={own.department.committedAed} of={own.department.allocationAed} />
              <p className="text-xs text-muted-foreground">
                {formatAed(Math.max(0, own.department.allocationAed - own.department.committedAed))} left. When it runs out, new awards wait until next month.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No budget has been set for your department this month yet.</p>
          )}
        </Card>
      </div>

      {own.pendingItems.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4 text-muted-foreground" /> Waiting for approval</p>
          <ul className="divide-y divide-border text-sm">
            {own.pendingItems.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{p.ruleName} <span className="text-xs text-muted-foreground">· {shortDay(p.day)}</span></span>
                <span className="flex items-center gap-2 text-xs">
                  {p.stage && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">with {STAGE_LABEL[p.stage]}</span>}
                  <span className="font-semibold tabular-nums">+{p.points}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Recent activity</p>
          <Link href="/dgo-points/wallet" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            All of it <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {own.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No points yet. See <Link href="/dgo-points/earn" className="text-primary hover:underline">how to earn them</Link>.</p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Day</th>
                  <th className="px-4 py-2 font-medium">What</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {own.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{shortDay(r.day)}</td>
                    <td className="px-4 py-2">{r.description}</td>
                    <td className="px-4 py-2"><LedgerTypeChip row={r} /></td>
                    <td className="px-4 py-2 text-right"><LedgerPoints row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {/* Status words, for anyone wondering what "Held" means. */}
      <p className="text-xs text-muted-foreground">
        Points are worth {formatAed(d.pointValueAed)} each. A request can be <StatusPill status="pending" />, <StatusPill status="posted" /> or held when the daily cap or your department&apos;s budget is used up.
      </p>
    </>
  );
}

function Team({ d }: { d: DgoDashboard }) {
  const members = d.team!.members;
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Your team this month</p>
      </div>
      {members.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody in your department yet.</p>
      ) : (
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 text-right font-medium">This month</th>
                <th className="px-4 py-2 text-right font-medium">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.employeeId}>
                  <td className="px-4 py-2">{m.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m.department ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPoints(m.monthPoints)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPoints(m.available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

const BASIS: Record<NonNullable<DgoDashboard["company"]>["tierBasis"], string> = {
  confirmed: "set by this month's confirmed collections",
  previous_month: "set by last month's confirmed collections until finance confirms this month",
  lowest: "the lowest tier until finance confirms a collections figure",
};

function Company({ d }: { d: DgoDashboard }) {
  const c = d.company!;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Company</p>
        <span className="text-xs text-muted-foreground">Tier: {c.tierLabel}, {BASIS[c.tierBasis]}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Points issued" value={formatPoints(c.pointsIssued)} sub={formatAed(c.aedIssued)} />
        <Stat label="Everyday pool used" value={formatAed(c.committedAed)} sub={`of ${formatAed(c.everydayAed)}`} tone={c.committedAed >= c.everydayAed ? "warn" : undefined} />
        <Stat label="Elite pool" value={c.eliteUnlocked ? formatAed(c.eliteAed) : "Locked"} sub={c.eliteUnlocked ? "Unlocked this month" : "Opens at AED 1.2m collections"} tone={c.eliteUnlocked ? "gold" : "muted"} />
        <Stat label="Earning points" value={`${c.employeesEarning} / ${c.activeEmployees}`} sub={`${c.pendingApprovals} waiting for approval`} />
      </div>
      <Card className="p-4">
        <div className="flex justify-between text-xs"><span>Everyday pool</span><span className="tabular-nums font-medium">{formatAed(c.committedAed)} of {formatAed(c.everydayAed)}</span></div>
        <UsageBar used={c.committedAed} of={c.everydayAed} className="mt-1" />
        <Link href="/dgo-points/budgets" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Budgets &amp; Finance <ArrowRight className="h-3 w-3" />
        </Link>
      </Card>
    </div>
  );
}
