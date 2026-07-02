import * as XLSX from "xlsx";

export type ExcelRow = Record<string, string | number | null | undefined>;

/** Export a single sheet of rows to an .xlsx file. */
export function exportToExcel(filename: string, rows: ExcelRow[], sheetName = "Sheet1") {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** Export multiple named sheets to one workbook. */
export function exportSheetsToExcel(filename: string, sheets: { name: string; rows: ExcelRow[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
