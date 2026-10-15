import ExcelJS from "exceljs";
import type { Cell } from "../types.ts";

/**
 * Turns an uploaded .xlsx into plain rows for parseMt5Report.
 * UNTESTED so far: written before exceljs could be installed. First task once
 * npm works is a test that loads the real report through this and compares it
 * with tests/fixtures/mt5-funded-next.json.
 */
export async function readXlsxRows(data: ArrayBuffer | Uint8Array): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets.");
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= 15; c++) {
      const v = row.getCell(c).value;
      cells.push(v instanceof Date ? null : typeof v === "object" && v !== null ? ((v as { result?: Cell }).result ?? null) : (v as Cell));
    }
    rows.push(cells);
  });
  return rows;
}
