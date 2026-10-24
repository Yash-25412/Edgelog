import ExcelJS from "exceljs";
import JSZip from "jszip";
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
 * Some MT5 builds write every XML part of the .xlsx as UTF-16 (byte-order mark FF FE / FE FF), which
 * Excel accepts but the XML reader used here does not ("disallowed character"). Re-encode those parts
 * as UTF-8 before loading. Files that are already UTF-8 are returned untouched.
 */
export async function normalizeEncoding(data: Uint8Array | ArrayBuffer): Promise<Uint8Array | ArrayBuffer> {
  const zip = await JSZip.loadAsync(data);
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir || !/\.(xml|rels)$/i.test(name)) continue;
    const b = await f.async("uint8array");
    const le = b[0] === 0xff && b[1] === 0xfe, be = b[0] === 0xfe && b[1] === 0xff;
    if (!le && !be) continue;
    const text = new TextDecoder(le ? "utf-16le" : "utf-16be").decode(b.slice(2));
    zip.file(name, text.replace(/^(<\?xml[^>]*?)\s+encoding=["'][^"']*["']/i, "$1"));
    changed = true;
  }
  return changed ? await zip.generateAsync({ type: "uint8array" }) : data;
}

/**
 * Turns an uploaded .xlsx into plain rows for parseMt5Report (first sheet).
 * Row index in the result equals Excel row number minus one.
 * Not covered by automated tests yet (needs exceljs installed); the parser itself is.
 */
export async function readXlsxRows(data: Uint8Array | ArrayBuffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load((await normalizeEncoding(data)) as any);
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
