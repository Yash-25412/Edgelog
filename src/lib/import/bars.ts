import type { Stamp } from "../types.ts";

export interface Bar {
  /** Start of the bar, broker time, "YYYY-MM-DDTHH:mm:ss". */
  time: Stamp;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
}

const DATE_RE = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses MetaTrader 5's "Export Bars" file (Ctrl+U > Bars > Export Bars):
 * tab separated, header <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>.
 * Comma or semicolon separated variants work too. Times stay in broker time.
 * Rows are returned oldest first; rows that cannot be read are counted, not hidden.
 */
export function parseMt5Bars(text: string): { bars: Bar[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("The bars file is empty.");
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(sep).map((h) => h.replace(/[<>"]/g, "").trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iDate = col("date"), iTime = col("time"), iO = col("open"), iH = col("high"), iL = col("low"), iC = col("close");
  const iV = header.includes("tickvol") ? col("tickvol") : col("volume");
  if ([iDate, iTime, iO, iH, iL, iC].some((i) => i === -1)) {
    throw new Error("This does not look like an MT5 bars export (needs DATE, TIME, OPEN, HIGH, LOW, CLOSE columns).");
  }

  const bars: Bar[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const c = line.split(sep);
    const d = DATE_RE.exec((c[iDate] ?? "").trim());
    const t = TIME_RE.exec((c[iTime] ?? "").trim());
    const open = Number(c[iO]), high = Number(c[iH]), low = Number(c[iL]), close = Number(c[iC]);
    if (!d || !t || [open, high, low, close].some((x) => !Number.isFinite(x)) || high < low) {
      skipped++;
      continue;
    }
    bars.push({
      time: `${d[1]}-${d[2]}-${d[3]}T${t[1]}:${t[2]}:${t[3] ?? "00"}`,
      open,
      high,
      low,
      close,
      tickVolume: iV === -1 ? 0 : Number(c[iV]) || 0,
    });
  }
  bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return { bars, skipped };
}
