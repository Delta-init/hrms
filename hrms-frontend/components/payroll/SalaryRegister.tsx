"use client";
import { useState } from "react";
import { Loader2, Download, Landmark, FileSpreadsheet } from "lucide-react";
import { useSalaryRegister } from "@/hooks/usePayslips";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getInitials } from "@/lib/utils";
import type { SalaryRegisterRow } from "@/types";

const curMonth = () => new Date().toISOString().slice(0, 7);
const money = (n: number, c: string) => `${c} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; };

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function download(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function SalaryRegister() {
  const [month, setMonth] = useState(curMonth());
  const { data, isLoading, isFetching } = useSalaryRegister(month);
  const rows = data?.rows ?? [];
  const currency = data?.currency ?? "AED";
  const totals = data?.totals;

  const exportRegister = () => {
    const header = ["Employee Code", "Name", "Designation", "Currency", "Gross", "Deductions", "Net", "IBAN", "Bank", "Structure"];
    const body = rows.map((r) => [
      r.employee.employeeCode ?? "", r.employee.name, r.employee.designation ?? "", r.currency,
      r.gross, r.totalDeductions, r.net, r.bank.iban, r.bank.bankName, r.structureName ?? "",
    ]);
    if (totals) body.push(["", "TOTAL", "", currency, totals.gross, totals.deductions, totals.net, "", "", ""]);
    download(`salary-register-${month}.csv`, [header, ...body]);
  };

  // A generic bank-transfer CSV, one row per employee's net credit — this is
  // NOT the UAE Central Bank / MoHRE Salary Information File (SIF) format
  // that WPS submission actually requires (no Establishment ID, WPS agent
  // routing code, labor card number, etc.). Use it to brief your bank/exchange
  // house, not as a direct WPS upload.
  const exportBankTransfer = () => {
    const header = ["Employee Code", "Name in Bank", "IBAN", "Account Number", "Bank", "Net Salary", "Currency"];
    const body = rows
      .filter((r) => r.net > 0)
      .map((r) => [r.employee.employeeCode ?? "", r.bank.nameInBank || r.employee.name, r.bank.iban, r.bank.accountNumber, r.bank.bankName, r.net, r.currency]);
    download(`bank-transfer-${month}.csv`, [header, ...body]);
  };

  const missingBank = rows.filter((r) => r.net > 0 && !r.bank.iban).length;

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Register month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[170px]" />
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Employees</p>
            <p className="font-semibold">{totals?.count ?? 0}</p>
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total net</p>
            <p className="font-semibold tabular-nums text-primary">{money(totals?.net ?? 0, currency)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportRegister} disabled={!rows.length}><FileSpreadsheet className="h-4 w-4" />Export register</Button>
          <Button onClick={exportBankTransfer} disabled={!rows.length} className="shadow-sm"><Landmark className="h-4 w-4" />Bank transfer file (CSV)</Button>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        The bank transfer file is a generic CSV of net pay and bank details — it is not the UAE Central Bank / MoHRE Salary Information File (SIF) format that WPS submission requires. Use it to prepare a transfer with your bank or exchange house, not as a direct WPS upload.
      </p>

      {missingBank > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700">
          {missingBank} employee(s) with a net payable have no IBAN on file — they are omitted from the bank transfer file.
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 text-right font-medium">Gross</th>
                <th className="px-4 py-3 text-right font-medium">Deductions</th>
                <th className="px-4 py-3 text-right font-medium">Net</th>
                <th className="px-4 py-3 font-medium">IBAN</th>
              </tr>
            </thead>
            <tbody>
              {isLoading || isFetching ? (
                <tr><td colSpan={5} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center text-muted-foreground"><Download className="mx-auto mb-2 h-7 w-7" />No active employees for this month.</td></tr>
              ) : rows.map((r) => <Row key={r.employee._id} r={r} />)}
            </tbody>
            {totals && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3">Total · {totals.count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{money(totals.gross, currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-500">{money(totals.deductions, currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-primary">{money(totals.net, currency)}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

function Row({ r }: { r: SalaryRegisterRow }) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(r.employee.name)}</div>
          <div className="min-w-0"><p className="truncate font-medium">{r.employee.name}</p><p className="truncate text-xs text-muted-foreground">{r.employee.employeeCode}{r.structureName ? ` · ${r.structureName}` : ""}</p></div>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{money(r.gross, r.currency)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">{r.totalDeductions > 0 ? money(r.totalDeductions, r.currency) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-primary">{money(r.net, r.currency)}</td>
      <td className="px-4 py-3">
        {r.bank.iban ? <span className="font-mono text-xs">{r.bank.iban}</span> : <span className="text-xs text-amber-600">No IBAN</span>}
      </td>
    </tr>
  );
}
