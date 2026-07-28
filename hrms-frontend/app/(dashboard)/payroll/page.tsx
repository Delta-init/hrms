"use client";
import { useState } from "react";
import { Wallet, Plus, MoreHorizontal, Pencil, Trash2, Printer, ListChecks, Send, Loader2, FileText, CalendarRange, Coins, Layers } from "lucide-react";
import { usePayslips, useMyPayslips, useDeletePayslip } from "@/hooks/usePayslips";
import { useEmployees } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { PayrollRun } from "@/components/payroll/PayrollRun";
import { OneTimeAdjustments } from "@/components/payroll/OneTimeAdjustments";
import { SalaryStructures } from "@/components/payroll/SalaryStructures";
import { printPayslip } from "@/components/payroll/printPayslip";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { PAYSLIP_STATUS_LABELS, type Payslip, type PayslipStatus } from "@/types";

const ALL = "__all__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const statusStyles: Record<PayslipStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  issued: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};
const fmtMonth = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; };
const money = (n: number, c: string) => `${c} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const empName = (p: Payslip) => (typeof p.employee === "object" ? p.employee.name : "—");

export default function PayrollPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("payroll", "view");
  const canCreate = hasPermission("payroll", "create");
  const canEdit = hasPermission("payroll", "edit");
  const canDelete = hasPermission("payroll", "delete");

  const [tab, setTab] = useState("run");
  const query = useTableQuery({ defaultSortBy: "month", defaultSortOrder: "desc", defaultLimit: 20 });
  const { data, isLoading, isFetching } = usePayslips(canView ? query.params : undefined);
  const { data: mineData, isLoading: mineLoading } = useMyPayslips({ limit: "50" });
  const { data: empData } = useEmployees(canView ? { limit: "200" } : undefined);
  const employees = empData?.data ?? [];
  const { mutate: remove, isPending: deleting } = useDeletePayslip();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Payslip | null>(null);
  const [selected, setSelected] = useState<Payslip | null>(null);

  const tabs = [
    canView && { key: "run", label: "Payroll Run", icon: CalendarRange },
    canView && { key: "onetime", label: "One-time", icon: Coins },
    canView && { key: "structures", label: "Structures", icon: Layers },
    canView && { key: "payslips", label: "Payslips", icon: ListChecks },
    { key: "mine", label: "My Payslips", icon: Send },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "mine");

  const columns: DataTableColumn<Payslip>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (p) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(empName(p))}</div>
          <div className="min-w-0"><p className="truncate font-medium">{empName(p)}</p><p className="truncate text-xs text-muted-foreground">{typeof p.employee === "object" ? p.employee.employeeCode : ""}</p></div>
        </div>
      ),
    },
    { id: "month", label: "Month", sortKey: "month", render: (p) => fmtMonth(p.month) },
    { id: "gross", label: "Gross", sortKey: "grossPay", align: "right", render: (p) => <span className="tabular-nums text-emerald-600">{money(p.grossPay, p.currency)}</span> },
    { id: "deductions", label: "Deductions", defaultVisible: false, align: "right", render: (p) => <span className="tabular-nums text-red-500">{money(p.totalDeductions, p.currency)}</span> },
    { id: "net", label: "Net Pay", sortKey: "netPay", align: "right", render: (p) => <span className="font-semibold tabular-nums text-primary">{money(p.netPay, p.currency)}</span> },
    { id: "status", label: "Status", sortKey: "status", render: (p) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[p.status])}>{PAYSLIP_STATUS_LABELS[p.status]}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => printPayslip(p)} className="cursor-pointer"><Printer className="mr-2 h-4 w-4" />Print / PDF</DropdownMenuItem>
            {canEdit && <DropdownMenuItem onClick={() => { setSelected(p); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem onClick={() => setDeleteTarget(p)} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filters = (
    <>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Employee</Label>
        <Select value={query.filters.employee ?? ALL} onValueChange={(v) => query.setFilter("employee", v)}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All employees</SelectItem>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Month</Label>
        <Input type="month" value={query.filters.month ?? ""} onChange={(e) => query.setFilter("month", e.target.value)} className="h-9 w-[150px]" />
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All status</SelectItem>{(["draft", "issued", "paid"] as PayslipStatus[]).map((s) => <SelectItem key={s} value={s}>{PAYSLIP_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </>
  );

  const mine = mineData?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Generate payslips and manage salary statements."
        icon={Wallet}
        action={canCreate && activeTab === "payslips" && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />Generate Payslip</Button>}
      />

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "run" && canView && <PayrollRun />}

      {activeTab === "onetime" && canView && <OneTimeAdjustments />}

      {activeTab === "structures" && canView && <SalaryStructures />}

      {activeTab === "payslips" && (
        <DataTable
          tableId="payslips" columns={columns} rows={data?.data ?? []} rowKey={(p) => p._id}
          loading={isLoading || isFetching} pagination={data?.pagination} query={query}
          searchable={false} filters={filters} rowLabel="payslips" emptyText="No payslips yet." minWidth={760}
          exportName="payslips"
          exportMapper={(p) => ({ Employee: empName(p), Code: typeof p.employee === "object" ? p.employee.employeeCode : "", Month: fmtMonth(p.month), Currency: p.currency, Gross: p.grossPay, Deductions: p.totalDeductions, Net: p.netPay, Status: PAYSLIP_STATUS_LABELS[p.status] })}
        />
      )}

      {activeTab === "mine" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mineLoading ? (
            <div className="col-span-full flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : mine.length === 0 ? (
            <Card className="col-span-full p-16 text-center text-muted-foreground">No payslips issued to you yet.</Card>
          ) : mine.map((p) => (
            <Card key={p._id} className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div>
                <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[p.status])}>{PAYSLIP_STATUS_LABELS[p.status]}</span>
              </div>
              <p className="text-sm text-muted-foreground">{fmtMonth(p.month)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-primary">{money(p.netPay, p.currency)}</p>
              <p className="text-xs text-muted-foreground">Net pay · Gross {money(p.grossPay, p.currency)}</p>
              <Button variant="outline" size="sm" className="mt-4 w-full gap-1.5" onClick={() => printPayslip(p)}><Printer className="h-3.5 w-3.5" />Download PDF</Button>
            </Card>
          ))}
        </div>
      )}

      <PayslipDialog open={dialogOpen} onOpenChange={setDialogOpen} payslip={selected} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete payslip" description="This payslip will be permanently removed."
        isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
