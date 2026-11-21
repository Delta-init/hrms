"use client";
import { useState } from "react";
import { Coins, History, Layers, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Pagination } from "@/components/shared/Pagination";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDgoWallet, useDgoLots, formatAed, formatPoints, dgoAed, dgoErrorMessage } from "@/hooks/useDgoPoints";
import {
  DgoGate, DgoPersonSelect, LedgerPoints, Notice, Spinner, Stat, TableWrap, LEDGER_LABEL, dayLabel, shortDay, dateTime,
} from "@/components/dgo/shared";
import type { DgoLedgerType, DgoMe } from "@/types";

const ALL = "__all__";
const TYPES: DgoLedgerType[] = ["credit", "reverse", "expire", "reserve", "release", "redeem", "adjust"];

export default function DgoWalletPage() {
  return (
    <DgoGate allow={(me) => me.canUse}>
      {(me) => <WalletPage me={me} />}
    </DgoGate>
  );
}

function WalletPage({ me }: { me: DgoMe }) {
  const [tab, setTab] = useState<"transactions" | "lots">("transactions");
  // Somebody else's points — finance, audit and Super Admin only. Empty is your own.
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("");
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const lookingUp = !!employeeId;
  const noOwnRecord = !me.employee && !lookingUp;
  const wallet = useDgoWallet(
    { employeeId: employeeId || undefined, type: type || undefined, from: range.from, to: range.to, page, limit },
    !noOwnRecord,
  );
  const lots = useDgoLots(employeeId || undefined, !noOwnRecord && tab === "lots");
  const w = wallet.data;
  const b = w?.balances;
  const pv = w?.pointValueAed ?? me.pointValueAed;

  return (
    <div>
      <PageHeader
        title={lookingUp && w ? `${w.employee.name}'s points` : "My Points"}
        description="Every point earned, spent, reversed or expired. Nothing here is ever edited; a correction is its own line."
        icon={Coins}
        action={
          me.can.walletLookup ? (
            <DgoPersonSelect
              value={employeeId}
              onChange={(id) => { setEmployeeId(id); setPage(1); }}
              placeholder="Someone else's points"
              allowClear
              className="h-9 w-full sm:w-[230px]"
            />
          ) : undefined
        }
      />

      {noOwnRecord ? (
        <Notice text="Your login isn't linked to an employee record, so you have no points of your own. Pick a person above to look someone up." />
      ) : wallet.isLoading ? (
        <Spinner />
      ) : wallet.error || !w || !b ? (
        <Notice text={dgoErrorMessage(wallet.error, "These points couldn't be loaded. Try again in a moment.")} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Available" value={formatPoints(b.available)} sub={formatAed(dgoAed(b.available, pv))} tone="gold" />
            <Stat label="Waiting for approval" value={formatPoints(b.pending)} sub="not yet yours" />
            <Stat label="Reserved" value={formatPoints(b.reserved)} sub="held for rewards until HR hands them over" />
            <Stat label="Spent on rewards" value={formatPoints(b.redeemed)} sub="lifetime" />
            <Stat label="Expired" value={formatPoints(b.expired)} sub="after 12 months" tone={b.expired ? "warn" : undefined} />
            <Stat label="Earned in all" value={formatPoints(b.lifetimeEarned)} sub={b.reversed ? `${formatPoints(b.reversed)} reversed` : "none reversed"} />
          </div>

          <Card className="p-0">
            <div className="px-4 pt-3">
              <Tabs
                layoutId="dgo-wallet-tabs"
                value={tab}
                onChange={(k) => setTab(k as typeof tab)}
                tabs={[
                  { key: "transactions", label: "Transactions", icon: History, count: w.pagination.total },
                  { key: "lots", label: "Point lots (expiry)", icon: Layers },
                ]}
              />
            </div>

            {tab === "transactions" ? (
              <>
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  <Select value={type || ALL} onValueChange={(v) => { setType(v === ALL ? "" : v); setPage(1); }}>
                    <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All types</SelectItem>
                      {TYPES.map((t) => <SelectItem key={t} value={t}>{LEDGER_LABEL[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <DateRangeFilter
                    from={range.from}
                    to={range.to}
                    onChange={(r) => { setRange(r); setPage(1); }}
                    onClear={() => { setRange({}); setPage(1); }}
                  />
                  {wallet.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {w.rows.length === 0 ? (
                  <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">Nothing here for these filters.</p>
                ) : (
                  <TableWrap className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="px-4 py-2 font-medium">Day</th>
                          <th className="px-4 py-2 font-medium">What</th>
                          <th className="px-4 py-2 font-medium">Rule</th>
                          <th className="px-4 py-2 font-medium">Type</th>
                          <th className="px-4 py-2 font-medium">By</th>
                          <th className="px-4 py-2 font-medium">Expires</th>
                          <th className="px-4 py-2 text-right font-medium">Points</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {w.rows.map((r) => (
                          <tr key={r.id}>
                            <td className="whitespace-nowrap px-4 py-2 text-muted-foreground" title={dateTime(r.at)}>{shortDay(r.day)}</td>
                            <td className="min-w-[12rem] px-4 py-2">{r.description}</td>
                            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.ruleCode ?? "—"}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{LEDGER_LABEL[r.type]}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{r.byName ?? "—"}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{r.expiresOn ? shortDay(r.expiresOn) : "—"}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-right"><LedgerPoints row={r} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
                <Pagination
                  pagination={{ ...w.pagination, hasNextPage: w.pagination.page < w.pagination.totalPages, hasPrevPage: w.pagination.page > 1 }}
                  page={page}
                  limit={limit}
                  onPageChange={setPage}
                  onLimitChange={(n) => { setLimit(n); setPage(1); }}
                  label="lines"
                />
              </>
            ) : lots.isLoading ? (
              <Spinner />
            ) : lots.error ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{dgoErrorMessage(lots.error, "The point lots couldn't be loaded.")}</p>
            ) : (lots.data ?? []).length === 0 ? (
              <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">No points earned yet.</p>
            ) : (
              <>
                <p className="px-4 pb-3 text-xs text-muted-foreground">
                  Each award is a lot with its own expiry. Rewards use the lots that expire first.
                </p>
                <TableWrap className="border-t border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Earned</th>
                        <th className="px-4 py-2 font-medium">For</th>
                        <th className="px-4 py-2 text-right font-medium">Issued</th>
                        <th className="px-4 py-2 text-right font-medium">Reserved</th>
                        <th className="px-4 py-2 text-right font-medium">Left</th>
                        <th className="px-4 py-2 font-medium">Expires</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lots.data!.map((l) => (
                        <tr key={l.id} className={cn(l.remaining === 0 && "text-muted-foreground")}>
                          <td className="whitespace-nowrap px-4 py-2">{shortDay(l.issuedOn)}</td>
                          <td className="min-w-[12rem] px-4 py-2">{l.description}{l.ruleCode && <span className="ml-1 font-mono text-xs text-muted-foreground">{l.ruleCode}</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatPoints(l.issued)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatPoints(l.reserved)}</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatPoints(l.remaining)}</td>
                          <td className="whitespace-nowrap px-4 py-2">{dayLabel(l.expiresOn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
