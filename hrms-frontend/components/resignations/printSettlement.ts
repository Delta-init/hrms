import type { FinalSettlement } from "@/types";
import { escapeHtml as e } from "@/lib/utils";

/** Opens a print-ready full-&-final settlement statement in a new window. */
export function printSettlement(s: FinalSettlement, emp: { name?: string; employeeCode?: string; designation?: string } | null, lastWorkingDay?: string) {
  const money = (n: number) => `${e(s.currency)} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows = (arr: { label: string; amount: number }[]) =>
    arr.map((l) => `<tr><td>${e(l.label)}</td><td class="r">${money(l.amount)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">—</td></tr>`;
  const lwd = lastWorkingDay ? new Date(lastWorkingDay).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Final Settlement ${e(emp?.name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0} body{font-family:Inter,Arial,sans-serif;color:#0f172a;padding:32px;font-size:13px}
    .sheet{max-width:720px;margin:0 auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
    .head{background:#0f766e;color:#fff;padding:24px 28px;display:flex;justify-content:space-between;align-items:center}
    .head h1{font-size:20px;font-weight:800} .head .p{opacity:.85;font-size:12px;margin-top:2px}
    .badge{background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:12px;text-transform:capitalize}
    .body{padding:24px 28px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:20px}
    .grid .k{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.04em} .grid .v{font-weight:600}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    table{width:100%;border-collapse:collapse} th{text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;padding:6px 0;border-bottom:1px solid #e2e8f0}
    td{padding:7px 0;border-bottom:1px solid #f1f5f9} td.r{text-align:right;font-variant-numeric:tabular-nums} .muted{color:#94a3b8}
    .subtotal{display:flex;justify-content:space-between;font-weight:700;margin-top:8px;padding-top:8px}
    .net{margin-top:22px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
    .net .l{font-weight:700;color:#0f766e} .net .a{font-size:22px;font-weight:800;color:#0f766e}
    .foot{padding:16px 28px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;text-align:center}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="sheet">
      <div class="head">
        <div><h1>Delta HRMS</h1><div class="p">Full &amp; Final Settlement</div></div>
        <span class="badge">${s.settled ? "Settled" : "Draft"}</span>
      </div>
      <div class="body">
        <div class="grid">
          <div><div class="k">Employee</div><div class="v">${e(emp?.name)}</div></div>
          <div><div class="k">Employee Code</div><div class="v">${e(emp?.employeeCode)}</div></div>
          <div><div class="k">Designation</div><div class="v">${emp?.designation ? e(emp.designation) : "—"}</div></div>
          <div><div class="k">Last Working Day</div><div class="v">${lwd}</div></div>
          <div><div class="k">Tenure</div><div class="v">${s.tenureYears} yrs</div></div>
          <div><div class="k">Basic (day rate)</div><div class="v">${money(s.basic)} (${money(s.dayRate)}/day)</div></div>
        </div>
        <div class="cols">
          <div>
            <table><thead><tr><th>Payable</th><th class="r">Amount</th></tr></thead><tbody>${rows(s.earnings)}</tbody></table>
            <div class="subtotal"><span>Total payable</span><span>${money(s.totalEarnings)}</span></div>
          </div>
          <div>
            <table><thead><tr><th>Recoveries</th><th class="r">Amount</th></tr></thead><tbody>${rows(s.deductions)}</tbody></table>
            <div class="subtotal"><span>Total recovered</span><span>${money(s.totalDeductions)}</span></div>
          </div>
        </div>
        <div class="net"><span class="l">NET PAYABLE</span><span class="a">${money(s.netPayable)}</span></div>
        ${s.notes ? `<p style="margin-top:14px;color:#64748b">Note: ${e(s.notes)}</p>` : ""}
      </div>
      <div class="foot">This is a system-generated settlement statement · Delta HRMS</div>
    </div>
  </body></html>`;

  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
