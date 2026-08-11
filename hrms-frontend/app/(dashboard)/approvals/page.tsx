"use client";
import { useMemo, useState } from "react";
import { Loader2, ShieldCheck, Search, Inbox, History, Check, X, Info } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { ReviewDialog } from "@/components/shared/ReviewDialog";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAllOrganizations } from "@/hooks/useOrganizations";
import { useApprovalInbox, useDecideApproval, useBulkDecideApprovals } from "@/hooks/useApprovalInbox";
import { ApprovalRowCard } from "@/components/approvals/ApprovalRowCard";
import { ApprovalDetailDialog } from "@/components/approvals/ApprovalDetailDialog";
import { MODULE_TONE } from "@/components/approvals/shared";
import type { ApprovalModule, ApprovalRow } from "@/types";

const ALL = "__all__";

type View = "pending" | "decided";
/** What the confirm dialog is about to do. */
type Intent = { approve: boolean; row?: ApprovalRow; bulk?: boolean };

/**
 * Everything waiting on management, across every organisation.
 *
 * There is deliberately no "waiting on me" view. This console is open to Super
 * Admins only, who hold every step of every chain, so the distinction would
 * always be empty — what is useful is *which role* is holding each request,
 * and every row says that instead.
 */
export default function ApprovalsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const isManagement = !!role?.isSystemRole && role.roleName === "Super Admin";

  const [view, setView] = useState<View>("pending");
  const [module, setModule] = useState<ApprovalModule | "">("");
  const [org, setOrg] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const debounced = useDebouncedValue(search, 300);

  const [selected, setSelected] = useState<{ module: ApprovalModule; ids: string[] } | null>(null);
  const [detail, setDetail] = useState<ApprovalRow | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);

  const params: Record<string, string> = { view };
  if (org) params.organization = org;
  if (debounced.trim()) params.search = debounced.trim();
  if (range.from) params.from = range.from;
  if (range.to) params.to = range.to;

  const { data, isLoading } = useApprovalInbox(params);
  const { data: orgs } = useAllOrganizations(isManagement);
  const { mutate: decide, isPending: deciding } = useDecideApproval();
  const { mutate: bulkDecide, isPending: bulkDeciding } = useBulkDecideApprovals();

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // Counted here rather than taken from the response so a chip's number always
  // matches what clicking it shows — the server's counts are deliberately taken
  // before the search is applied.
  const counts = useMemo(
    () => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.module]: (acc[r.module] ?? 0) + 1 }), {}),
    [rows]
  );
  const chips = useMemo(() => {
    const seen: Record<string, string> = {};
    for (const r of rows) seen[r.module] = r.moduleLabel;
    return Object.entries(seen).map(([m, label]) => ({ module: m as ApprovalModule, label, count: counts[m] ?? 0 }));
  }, [rows, counts]);

  const visible = module ? rows.filter((r) => r.module === module) : rows;

  const selectedIds = selected?.ids ?? [];
  const selectedSet = new Set(selectedIds);
  const selectableVisible = view === "pending" ? visible.filter((r) => !selected || r.module === selected.module) : [];
  const allSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selectedSet.has(r.id));

  const toggleRow = (row: ApprovalRow, checked: boolean) => {
    setSelected((prev) => {
      // Picking a different type replaces the selection rather than mixing:
      // each module has its own rules and a mixed batch cannot report a
      // meaningful failure.
      const base = prev && prev.module === row.module ? prev.ids : [];
      const ids = checked ? [...base, row.id] : base.filter((id) => id !== row.id);
      return ids.length ? { module: row.module, ids } : null;
    });
  };

  // Whose "all" this is: whatever is already ticked, else the filtered type.
  const selectAllTarget = selected?.module ?? (module || null);
  const selectAllCount = selectAllTarget ? visible.filter((r) => r.module === selectAllTarget).length : 0;

  const toggleAll = () => {
    if (allSelected) { setSelected(null); return; }
    if (!selectAllTarget) return;
    const ids = visible.filter((r) => r.module === selectAllTarget).map((r) => r.id);
    setSelected(ids.length ? { module: selectAllTarget, ids } : null);
  };

  const confirm = (note: string) => {
    if (!intent) return;
    if (intent.bulk && selected) {
      bulkDecide(
        { module: selected.module, ids: selected.ids, approve: intent.approve, note },
        { onSuccess: () => { setSelected(null); setIntent(null); } }
      );
      return;
    }
    if (intent.row) {
      decide(
        { module: intent.row.module, id: intent.row.id, approve: intent.approve, note },
        { onSuccess: () => { setIntent(null); setDetail(null); } }
      );
    }
  };

  if (!isManagement) {
    return (
      <div className="space-y-6">
        <PageHeader title="Approvals" description="Everything waiting on management." icon={ShieldCheck} />
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          This console reads across every organisation, so it is open to Super Admins only. Requests waiting on
          your own role appear in each module — Leave, Hiring, Reimbursements and the rest.
        </p>
      </div>
    );
  }

  const busy = deciding || bulkDeciding;
  const bulkSubject = selected
    ? `${selected.ids.length} ${chips.find((c) => c.module === selected.module)?.label ?? selected.module} request${selected.ids.length === 1 ? "" : "s"}`
    : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Everything waiting on you, across every organisation."
        icon={ShieldCheck}
      />

      <Tabs
        value={view}
        onChange={(k) => { setView(k as View); setSelected(null); }}
        tabs={[
          { key: "pending", label: "Waiting", icon: Inbox, count: view === "pending" ? data?.total : undefined },
          { key: "decided", label: "Decided", icon: History },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by person, title or organisation…"
            className="h-9 pl-9"
          />
        </div>

        <Select value={org || ALL} onValueChange={(v) => setOrg(v === ALL ? "" : v)}>
          <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="All organisations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All organisations</SelectItem>
            {(orgs ?? []).map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <DateRangeFilter
          from={range.from}
          to={range.to}
          onChange={(r) => setRange(r)}
          onClear={() => setRange({})}
          label={view === "decided" ? "Decided" : "Raised"}
        />
      </div>

      {/* Type filter. Applied here rather than server-side so the counts stay
          complete however the list is narrowed. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => { setModule(""); }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              module === "" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            All <span className="tabular-nums">{rows.length}</span>
          </button>
          {chips.map((c) => (
            <button
              key={c.module}
              type="button"
              onClick={() => setModule(module === c.module ? "" : c.module)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                module === c.module ? MODULE_TONE[c.module] : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {c.label} <span className="tabular-nums">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Said out loud rather than applied quietly: a list that stops at 200
          reads as "that is everything", which is the one thing it is not. */}
      {!!data?.capped?.length && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Showing the first {data.limit} of {data.capped.join(", ")} — narrow by organisation or date to see the rest.
        </p>
      )}

      {selected && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">{bulkSubject} selected</span>
          <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground underline">
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline" size="sm" disabled={busy}
              onClick={() => setIntent({ approve: false, bulk: true })}
              className="border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              <X className="h-4 w-4" />Reject all
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setIntent({ approve: true, bulk: true })} className="bg-emerald-600 hover:bg-emerald-700">
              <Check className="h-4 w-4" />Approve all
            </Button>
          </div>
        </div>
      )}

      {/* Only offered once there is a type to select all *of* — either a chip is
          active or a row has been ticked. Without one, "select all" would have
          to pick a type arbitrarily and silently leave the rest behind. */}
      {view === "pending" && selectAllTarget && (
        <button type="button" onClick={toggleAll} className="text-xs text-muted-foreground underline">
          {allSelected
            ? "Clear selection"
            : `Select all ${selectAllCount} ${chips.find((c) => c.module === selectAllTarget)?.label ?? ""} shown`}
        </button>
      )}

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">
            {view === "pending" ? "Nothing is waiting" : "Nothing decided in this window"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {view === "pending"
              ? "Every request across every organisation has been dealt with."
              : "Widen the date range, or clear the filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((row) => (
            <ApprovalRowCard
              key={`${row.module}:${row.id}`}
              row={row}
              selectable={view === "pending"}
              selected={selectedSet.has(row.id)}
              lockedOut={!!selected && selected.module !== row.module}
              onSelect={(checked) => toggleRow(row, checked)}
              onView={() => setDetail(row)}
              onDecide={(approve) => setIntent({ approve, row })}
              isPending={busy}
            />
          ))}
        </div>
      )}

      <ApprovalDetailDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        row={detail}
        isPending={busy}
        onDecide={(approve) => detail && setIntent({ approve, row: detail })}
      />

      <ReviewDialog
        open={!!intent}
        onOpenChange={(o) => !o && setIntent(null)}
        action={intent?.approve ? "approved" : "rejected"}
        subject={intent?.bulk ? bulkSubject : intent?.row?.title}
        requireNote={intent?.bulk}
        isPending={busy}
        onConfirm={confirm}
      />
    </div>
  );
}
