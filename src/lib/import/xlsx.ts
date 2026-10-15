import ExcelJS from "exceljs";
import type { Cell } from "../types.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** A real Excel date -> the "YYYY.MM.DD HH:mm:ss" text MT5 itself writes. */
function dateToMt5(d: Date): string {
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function cellValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return dateToMt5(v);
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if ("result" in o) return cellValue(o.result);
    if (typeof o.text === "string") return o.text;
  }
  return null;
}

/**
 * Turns an uploaded .xlsx into plain rows for parseMt5Report (first sheet).
 * Row index in the result equals Excel row number minus one.
 * Not covered by automated tests yet (needs exceljs installed); the parser itself is.
 */
export async function readXlsxRows(data: Uint8Array | ArrayBuffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(data as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets.");
  const width = Math.max(ws.columnCount, 15);
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellValue(row.getCell(c).value));
    rows.push(cells);
  });
  return rows;
}
