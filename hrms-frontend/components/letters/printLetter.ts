import type { GeneratedLetter } from "@/types";
import { escapeHtml as e } from "@/lib/utils";

/** Opens a print-ready letter in a new window (user saves as PDF). */
export function printLetter(letter: GeneratedLetter) {
  const emp = typeof letter.employee === "object" ? letter.employee : null;
  const issued = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(letter.issuedAt));
  // Escape first, then turn newlines into <br> — so the only markup that
  // survives into the document is the line breaks we add ourselves.
  const bodyHtml = letter.content
    .split(/\n{2,}/)
    .map((para) => `<p>${e(para).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${e(letter.subject)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0} body{font-family:Inter,Arial,sans-serif;color:#0f172a;padding:32px;font-size:13.5px}
    .sheet{max-width:720px;margin:0 auto}
    .head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #4f46e5;padding-bottom:14px;margin-bottom:28px}
    .head h1{font-size:19px;font-weight:800;color:#4f46e5}
    .head .date{font-size:12px;color:#64748b}
    .subject{font-weight:700;margin-bottom:20px;text-decoration:underline}
    .content p{line-height:1.7;margin-bottom:14px;white-space:pre-wrap}
    .foot{margin-top:48px;padding-top:14px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;text-align:center}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="sheet">
      <div class="head">
        <h1>Delta HRMS</h1>
        <div class="date">${issued}</div>
      </div>
      <div class="subject">${e(letter.subject)}</div>
      <div class="content">${bodyHtml}</div>
      <div class="foot">This is a system-generated letter · Delta HRMS${emp ? ` · ${e(emp.name)}${emp.employeeCode ? ` (${e(emp.employeeCode)})` : ""}` : ""}</div>
    </div>
  </body></html>`;

  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
