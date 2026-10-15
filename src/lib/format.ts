export const money = (n: number | null | undefined, signed = false) =>
  n === null || n === undefined
    ? "–"
    : (signed && n > 0 ? "+" : "") + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : (n * 100).toFixed(1) + "%");

export const num2 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2));

export function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** "2026-09-14T09:42:03" -> "14 Sep 09:42" */
export function shortStamp(s: string): string {
  const [d, t] = s.split("T");
  const [, mo, da] = d.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(da)} ${months[Number(mo) - 1]} ${t.slice(0, 5)}`;
}
