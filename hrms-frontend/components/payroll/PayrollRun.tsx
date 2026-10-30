"use client";
import { useEffect, useState } from "react";
import { Loader2, Play, CalendarDays, Plus, Pencil, Undo2, X, Check, FileSpreadsheet, Upload, Search } from "lucide-react";
import { ImportSalarySheetDialog } from "@/components/payroll/ImportSalarySheetDialog";
import { toast } from "@/lib/toast";
import { downloadSalarySheet } from "@/lib/salarySheet";
import { usePayrollRun, useGeneratePayroll, usePayslip, useBulkPayslipStatus, useBulkDeletePayslips } from "@/hooks/usePayslips";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { Pagination } from "@/components/shared/Pagination";
import { PayrollChecklistDialog } from "@/components/payroll/PayrollChecklistDialog";
import { LopOverrideDialog, type LopTarget } from "@/components/payroll/LopOverrideDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { PayrollHandover } from "@/components/payroll/PayrollHandover";
import { usePayrollBatch } from "@/hooks/usePayrollBatch";
import {
  PAYSLIP_STATUS_LABELS, HR_SETTABLE_PAYSLIP_STATUSES,
  type PayrollRunRow, type PayslipStatus, type HrSettablePayslipStatus,
} from "@/types";

const statusStyles: Record<PayslipStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  issued: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};
const curMonth = () => new Date().toISOString().slice(0, 7);

/** The status chips over the run: every row, or one state — "pending" being not generated yet. */
type RunFilter = "all" | "pending" | PayslipStatus;
const RUN_FILTERS: { key: RunFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Not generated" },
  { key: "draft", label: PAYSLIP_STATUS_LABELS.draft },
  { key: "issued", label: PAYSLIP_STATUS_LABELS.issued },
  { key: "paid", label: PAYSLIP_STATUS_LABELS.paid },
];
const matchesFilter = (r: PayrollRunRow, f: RunFilter) => f === "all" || (f === "pending" ? r.status === null : r.status === f);
const money = (n: number, c: string) => `${c} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PayrollRun() {
  const { hasPermission } = useAuth();
  const [month, setMonth] = useState(curMonth());
  const { data: batch } = usePayrollBatch(month);

  /**
   * Once a month is with accounts nothing here may change it, whatever the
   * user's permissions say. The API refuses these writes too — this only keeps
   * the screen from offering an action that is going to come back as an error.
   */
  const locked = batch ? !batch.editable : false;
  const canGenerate = hasPermission("payroll", "create") && !locked;
  const canEdit = hasPermission("payroll", "edit") && !locked;
  const canDelete = hasPermission("payroll", "delete") && !locked;
  const canHandOver = hasPermission("payroll", "approve");
  const { data, isLoading, isFetching } = usePayrollRun(month);
  const { mutate: generate, isPending: generating } = useGeneratePayroll();

  const { mutate: bulkStatus, isPending: settingStatus } = useBulkPayslipStatus();
  const { mutate: bulkDelete, isPending: reverting } = useBulkDeletePayslips();

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revertOpen, setRevertOpen] = useState(false);
  const [createRow, setCreateRow] = useState<PayrollRunRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [lopTarget, setLopTarget] = useState<LopTarget | null>(null);
  const { data: editPayslip } = usePayslip(editId ?? undefined);

  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => r.status === null).length;

  // Search and status narrow what is shown — and what select-all and the bulk
  // actions reach — but never the month's totals or the salary sheet, which
  // accounts must always get whole.
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RunFilter>("all");
  const needle = search.trim().toLowerCase();
  const searched = needle
    ? rows.filter((r) => r.employee.name.toLowerCase().includes(needle) || (r.employee.employeeCode ?? "").toLowerCase().includes(needle))
    : rows;
  const shown = searched.filter((r) => matchesFilter(r, filter));
  const countFor = (f: RunFilter) => searched.filter((r) => matchesFilter(r, f)).length;
  const clearFilters = () => { setSearch(""); setFilter("all"); };

  // A page at a time: a hundred rows of figures, each with its own buttons,
  // was a lot to draw on every keystroke of the search. Select-all and the
  // bulk actions still reach every row the filters match, not just this page.
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  useEffect(() => { setPage(1); }, [month, needle, filter, limit]);
  const totalPages = Math.max(1, Math.ceil(shown.length / limit));
  const current = Math.min(page, totalPages);
  const pageRows = shown.slice((current - 1) * limit, current * limit);

  // Only generated rows can be selected — there is nothing to act on until a
  // payslip exists. Keyed by payslip id, so the set survives a refetch; a row
  // filtered out of view drops out of the selection's reach with it.
  const selectableIds = shown.map((r) => r.payslipId).filter(Boolean) as string[];
  const selectedIds = selectableIds.filter((id) => selected.has(id));
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const toggleOne = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const clearSelection = () => setSelected(new Set());
  const applyStatus = (status: HrSettablePayslipStatus) =>
    bulkStatus({ ids: selectedIds, status }, { onSuccess: clearSelection });
  /**
   * Net pay, one total per currency.
   *
   * This was every row's net added as a bare number and labelled with the first
   * row's currency, so rupee salaries were counted as dirhams. Led by the
   * month's headline currency so it matches the banner above, then by headcount.
   */
  const netByCurrency = (() => {
    const by = new Map<string, { currency: string; net: number; people: number }>();
    for (const r of rows) {
      const c = (r.currency || batch?.currency || "AED").toUpperCase();
      const t = by.get(c) ?? { currency: c, net: 0, people: 0 };
      t.net += r.netPay;
      t.people += 1;
      by.set(c, t);
    }
    const lead = batch?.currency;
    return Array.from(by.values()).sort(
      (a, b) =>
        (a.currency === lead ? 0 : 1) - (b.currency === lead ? 0 : 1) ||
        b.people - a.people ||
        a.currency.localeCompare(b.currency)
    );
  })();

  const [downloading, setDownloading] = useState(false);
  // Any row still ungenerated makes it a preview — its figures can move until
  // payroll is processed, and the sheet says so in its first line.
  const downloadSheet = async () => {
    setDownloading(true);
    try {
      await downloadSalarySheet(month, rows, pending > 0);
    } catch {
      toast.error("The salary sheet could not be created — try again");
    } finally {
      setDownloading(false);
    }
  };

  const preset = createRow
    ? {
        employeeId: createRow.employee._id,
        employeeName: createRow.employee.name,
        month,
        currency: createRow.currency,
        earnings: createRow.earnings?.length ? createRow.earnings : [{ label: "Basic", amount: createRow.salary }],
        // Only the structure's own lines. Loss of pay, late penalties and loan
        // instalments are all derived when the payslip is created — seeding
        // them here just put a figure in an editable box that the server was
        // going to recompute anyway.
        deductions: [...(createRow.structureDeductions ?? [])],
      }
    : null;
  const closeDialog = () => { setCreateRow(null); setEditId(null); };

  return (
    <div className="space-y-4">
      {/* Where the month stands with accounts. Above the figures, because it
          decides whether any of them can still be changed. */}
      <PayrollHandover month={month} canSubmit={canHandOver} />

      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Payroll month</Label>
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); clearSelection(); }} className="h-9 w-[170px]" />
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Employees</p>
            <p className="font-semibold">
              {isLoading ? "…" : <>{rows.length} · <span className="text-amber-600">{pending} pending</span></>}
              {/* A background refresh keeps the figures on screen; only the first load waits. */}
              {isFetching && !isLoading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Refreshing" />}
            </p>
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total net pay</p>
            {isLoading ? (
              <p className="font-semibold tabular-nums text-primary">…</p>
            ) : netByCurrency.length === 0 ? (
              <p className="font-semibold tabular-nums text-primary">{money(0, batch?.currency ?? "AED")}</p>
            ) : (
              // The headline currency large, any others beneath it — never summed.
              <>
                <p className="font-semibold tabular-nums text-primary">{money(netByCurrency[0]!.net, netByCurrency[0]!.currency)}</p>
                {netByCurrency.slice(1).map((t) => (
                  <p key={t.currency} className="text-xs font-medium tabular-nums text-muted-foreground">
                    + {money(t.net, t.currency)} <span className="font-normal">· {t.people} {t.people === 1 ? "person" : "people"}</span>
                  </p>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={downloadSheet} disabled={!rows.length || isLoading || downloading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Download salary sheet
          </Button>
          {canGenerate && canEdit && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />Import salary sheet
            </Button>
          )}
          {canGenerate && (
            <Button onClick={() => setChecklistOpen(true)} disabled={pending === 0} className="shadow-sm">
              <Play className="h-4 w-4" />Process Payroll ({pending})
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or employee code…" className="h-9 pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RUN_FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={cn("rounded-full border px-3 py-1 text-sm font-medium transition",
                filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted/50")}>
              {f.label} <span className="tabular-nums opacity-80">{countFor(f.key)}</span>
            </button>
          ))}
        </div>
      </Card>

      {selectedIds.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">
            {selectedIds.length} selected
            {totalPages > 1 && <span className="font-normal text-muted-foreground"> · across all pages</span>}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2" disabled={settingStatus}>
                    {settingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Set status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {HR_SETTABLE_PAYSLIP_STATUSES.map((st) => (
                    <DropdownMenuItem key={st} className="cursor-pointer" onSelect={() => applyStatus(st)}>
                      {PAYSLIP_STATUS_LABELS[st]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="h-8 gap-2 text-destructive" disabled={reverting} onClick={() => setRevertOpen(true)}>
                {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Back to not generated
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" />Clear
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    disabled={selectableIds.length === 0}
                    aria-label="Select all generated payslips"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 text-right font-medium">Base salary</th>
                <th className="px-4 py-3 text-right font-medium">LOP</th>
                <th className="px-4 py-3 text-right font-medium">Loan</th>
                <th className="px-4 py-3 text-right font-medium">Add-ons</th>
                <th className="px-4 py-3 text-right font-medium">Deductions</th>
                <th className="px-4 py-3 text-right font-medium">Net pay</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="py-16 text-center text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7" />No active employees for this month.</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={10} className="py-16 text-center text-muted-foreground">
                  <Search className="mx-auto mb-2 h-7 w-7" />No one matches.
                  <div className="mt-3"><Button variant="outline" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Clear filters</Button></div>
                </td></tr>
              ) : pageRows.map((r) => (
                <Row
                  key={r.employee._id}
                  r={r}
                  canEdit={canEdit}
                  canGenerate={canGenerate}
                  canDelete={canDelete}
                  selected={!!r.payslipId && selected.has(r.payslipId)}
                  onToggle={() => r.payslipId && toggleOne(r.payslipId)}
                  onAdd={() => setCreateRow(r)}
                  onEdit={() => r.payslipId && setEditId(r.payslipId)}
                  onRevert={() => { if (r.payslipId) { setSelected(new Set([r.payslipId])); setRevertOpen(true); } }}
                  onEditLop={() => setLopTarget({
                    employee: r.employee, month, days: r.lopDays, attendanceDays: r.attendanceLopDays ?? r.lopDays,
                    override: r.lopOverride, maxDays: r.workingDays,
                  })}
                />
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > 0 && (
          <Pagination
            pagination={{ total: shown.length, page: current, limit, totalPages, hasNextPage: current < totalPages, hasPrevPage: current > 1 }}
            page={current} limit={limit} onPageChange={setPage} onLimitChange={setLimit} label="employees"
          />
        )}
      </Card>

      <PayslipDialog
        open={!!createRow || (!!editId && !!editPayslip)}
        onOpenChange={(o) => { if (!o) closeDialog(); }}
        payslip={editId ? editPayslip : null}
        preset={preset}
      />

      <ConfirmDialog
        open={revertOpen}
        onOpenChange={(o) => { if (!o) setRevertOpen(false); }}
        title={selectedIds.length > 1 ? `Revert ${selectedIds.length} payslips?` : "Back to not generated?"}
        description={
          `${selectedIds.length > 1 ? "These payslips are" : "This payslip is"} deleted and the ${selectedIds.length > 1 ? "rows go" : "row goes"} back to not generated. ` +
          "Anything collected against loans, advances and one-time adjustments is handed back, so those balances return to what they were before payroll ran. " +
          "Any payslip already issued or paid will no longer exist."
        }
        isPending={reverting}
        onConfirm={() => bulkDelete(selectedIds, { onSuccess: () => { clearSelection(); setRevertOpen(false); } })}
      />

      <LopOverrideDialog target={lopTarget} onClose={() => setLopTarget(null)} />

      <ImportSalarySheetDialog open={importOpen} onOpenChange={setImportOpen} month={month} />

      <PayrollChecklistDialog
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        pendingCount={pending}
        processing={generating}
        onProcess={() => generate(month, { onSuccess: () => setChecklistOpen(false) })}
      />
    </div>
  );
}

function Row({ r, canEdit, canGenerate, canDelete, selected, onToggle, onAdd, onEdit, onRevert, onEditLop }: {
  r: PayrollRunRow; canEdit: boolean; canGenerate: boolean; canDelete: boolean;
  selected: boolean; onToggle: () => void; onAdd: () => void; onEdit: () => void; onRevert: () => void; onEditLop: () => void;
}) {
  // Not generated or still a draft, and not an imported sheet's figures — the
  // same rule the server holds.
  const lopEditable = canEdit && (r.status === null || r.status === "draft") && !r.importedAt;
  return (
    <tr className={cn("border-b border-border/60 last:border-0 hover:bg-muted/30", selected && "bg-primary/5")}>
      <td className="px-4 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={!r.payslipId}
          aria-label={`Select ${r.employee.name}`}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(r.employee.name)}</div>
          <div className="min-w-0"><p className="truncate font-medium">{r.employee.name}</p><p className="truncate text-xs text-muted-foreground">{r.employee.employeeCode}</p></div>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {money(r.salary, r.currency)}
        {r.structureName && <p className="text-[11px] font-normal text-muted-foreground" title="Salary structure in force">{r.structureName}</p>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">
        {/* Two different denominators used to sit side by side here — days lost
            "of 26", priced at "1/30" — which read as one sum and is two. The
            rate is shown as money instead, so the line multiplies out by eye. */}
        {r.lopAmount > 0 && (
          <div
            title={
              r.lopPerDay
                ? `${r.lopDays} day(s) × ${money(r.lopPerDay, r.currency)} (salary ÷ 30)` +
                  (r.workingDays ? ` · ${r.workingDays} working days this month` : "")
                : `${r.lopDays} day(s) lost`
            }
          >
            -{money(r.lopAmount, r.currency)}
            <span className="ml-1 text-[11px] text-muted-foreground">
              ({r.lopDays} day{r.lopDays === 1 ? "" : "s"}
              {r.lopPerDay ? ` × ${money(r.lopPerDay, r.currency)}` : ""})
            </span>
          </div>
        )}
        {r.latePenaltyAmount > 0 && <div title="Late-arrival penalty">-{money(r.latePenaltyAmount, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">({r.latePenaltyDays}d late)</span></div>}
        {r.lopAmount === 0 && r.latePenaltyAmount === 0 && <span className="text-muted-foreground">—</span>}
        {(r.lopOverride || lopEditable) && (
          <div className="mt-0.5 flex items-center justify-end gap-1">
            {r.lopOverride && (
              <span
                title={`Attendance says ${r.attendanceLopDays ?? 0} day(s). ${r.lopOverride.reason}${r.lopOverride.by ? ` — ${r.lopOverride.by}` : ""}`}
                className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
              >
                {r.lopAmount === 0 ? "0 days · " : ""}edited
              </span>
            )}
            {lopEditable && (
              <button type="button" onClick={onEditLop} title="Change loss of pay" aria-label={`Change loss of pay for ${r.employee.name}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">
        {r.loanTotal > 0 && <div>-{money(r.loanTotal, r.currency)}</div>}
        {(r.advanceTotal ?? 0) > 0 && (
          <div title="Salary advance being recovered">-{money(r.advanceTotal ?? 0, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">adv</span></div>
        )}
        {r.loanTotal === 0 && !(r.advanceTotal ?? 0) && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {r.oneTimePayments > 0 && <span className="text-emerald-600">+{money(r.oneTimePayments, r.currency)}</span>}
        {r.oneTimePayments > 0 && r.oneTimeDeductions > 0 && <span className="text-muted-foreground"> / </span>}
        {r.oneTimeDeductions > 0 && <span className="text-red-500">-{money(r.oneTimeDeductions, r.currency)}</span>}
        {r.reimbursements > 0 && <div className="text-emerald-600" title="Approved reimbursements">+{money(r.reimbursements, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">reimb</span></div>}
        {r.overtime > 0 && <div className="text-emerald-600" title="Overtime">+{money(r.overtime, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">OT</span></div>}
        {r.oneTimePayments === 0 && r.oneTimeDeductions === 0 && r.reimbursements === 0 && r.overtime === 0 && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">{r.totalDeductions > 0 ? `-${money(r.totalDeductions, r.currency)}` : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-primary">{money(r.netPay, r.currency)}</td>
      <td className="px-4 py-3">
        {r.status ? (
          <>
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>{PAYSLIP_STATUS_LABELS[r.status]}</span>
            {r.importedAt && <p className="mt-0.5 text-[11px] text-muted-foreground" title="Figures come from an imported salary sheet">from sheet</p>}
          </>
        ) : (
          <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">Not generated</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {r.status ? (
          <div className="flex items-center justify-end gap-1">
            {canEdit && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
            {/* Deleting the payslip is what puts the row back to "not
                generated" — there is no fourth status to move it to. */}
            {canDelete && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Back to not generated" onClick={onRevert}>
                <Undo2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          canGenerate && <Button variant="outline" size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add</Button>
        )}
      </td>
    </tr>
  );
}
