import type { Trade } from "../types.ts";
import { byHour, byWeekday, dailyPnL, type Day } from "./analytics.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2);

export interface Filters {
  q: string;
  side: "all" | "buy" | "sell";
  result: "all" | "win" | "loss";
  from: string; // YYYY-MM-DD or ""
  to: string;
}
export const NO_FILTERS: Filters = { q: "", side: "all", result: "all", from: "", to: "" };

export function filterTrades(trades: Trade[], f: Filters): Trade[] {
  const q = f.q.trim().toLowerCase();
  return trades.filter((t) => {
    if (q && !`${t.symbol} ${t.externalId} ${t.exitReason ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.side !== "all" && t.side !== f.side) return false;
    if (f.result === "win" && !(t.net > 0)) return false;
    if (f.result === "loss" && !(t.net < 0)) return false;
    const day = t.closeTime.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

export function totals(trades: Trade[]) {
  const net = r2(trades.reduce((s, t) => s + t.net, 0));
  const wins = trades.filter((t) => t.net > 0).length;
  return { n: trades.length, net, wins, winRate: trades.length ? wins / trades.length : null };
}

export interface MonthSummary {
  tradingDays: number;
  greenDays: number;
  redDays: number;
  best: Day | null;
  worst: Day | null;
  avgPerDay: number | null;
  /** longest run of consecutive green trading days */
  greenStreak: number;
  byWeekday: { day: string; net: number; n: number }[];
}

export function monthSummary(trades: Trade[], ym: string): MonthSummary {
  const inMonth = trades.filter((t) => t.closeTime.startsWith(ym));
  const days = dailyPnL(inMonth);
  let streak = 0, best = 0;
  for (const d of days) {
    streak = d.net > 0 ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  const wd = byWeekday(inMonth);
  return {
    tradingDays: days.length,
    greenDays: days.filter((d) => d.net > 0).length,
    redDays: days.filter((d) => d.net < 0).length,
    best: days.length ? days.reduce((a, b) => (b.net > a.net ? b : a)) : null,
    worst: days.length ? days.reduce((a, b) => (b.net < a.net ? b : a)) : null,
    avgPerDay: days.length ? r2(days.reduce((s, d) => s + d.net, 0) / days.length) : null,
    greenStreak: best,
    byWeekday: wd.map((b) => ({ day: b.key, net: b.net, n: b.n })),
  };
}

export interface Insight { text: string; tone: "good" | "bad" | "info"; tab?: "edge" | "calendar" | "trades" }

/** Plain-language facts computed from the trades. Only said when the sample is big enough to mean something. */
export function insights(trades: Trade[]): Insight[] {
  const out: Insight[] = [];
  if (trades.length < 10) return [{ text: "Add at least 10 trades and this panel will start pointing out patterns.", tone: "info" }];
  const longs = trades.filter((t) => t.side === "buy"), shorts = trades.filter((t) => t.side === "sell");
  const ln = r2(longs.reduce((s, t) => s + t.net, 0)), sn = r2(shorts.reduce((s, t) => s + t.net, 0));
  if (longs.length >= 10 && shorts.length >= 10 && Math.sign(ln) !== Math.sign(sn)) {
    const [w, l] = ln > sn ? ["Longs", "shorts"] : ["Shorts", "longs"];
    out.push({ text: `${w} made ${sign(Math.max(ln, sn))} while ${l} lost ${sign(Math.min(ln, sn))}.`, tone: "info", tab: "edge" });
  }
  const wd = byWeekday(trades).filter((b) => b.n >= 8);
  if (wd.length >= 2) {
    const worst = wd.reduce((a, b) => (b.net < a.net ? b : a)), best = wd.reduce((a, b) => (b.net > a.net ? b : a));
    if (worst.net < 0) out.push({ text: `${worst.key} is your weakest day: ${sign(worst.net)} over ${worst.n} trades.`, tone: "bad", tab: "edge" });
    if (best.net > 0) out.push({ text: `${best.key} is your strongest day: ${sign(best.net)} over ${best.n} trades.`, tone: "good", tab: "edge" });
  }
  const hr = byHour(trades).filter((b) => b.n >= 8);
  if (hr.length >= 2) {
    const worst = hr.reduce((a, b) => (b.net < a.net ? b : a));
    if (worst.net < 0) out.push({ text: `Trades entered around ${worst.key}:00 have lost ${sign(worst.net)} (${worst.n} trades).`, tone: "bad", tab: "edge" });
  }
  const days = dailyPnL(trades);
  const heavy = days.filter((d) => d.trades >= 6);
  if (heavy.length >= 2) {
    const calm = days.filter((d) => d.trades <= 3);
    const hAvg = heavy.reduce((s, d) => s + d.net, 0) / heavy.length;
    if (calm.length >= 2 && hAvg < calm.reduce((s, d) => s + d.net, 0) / calm.length)
      out.push({ text: `On days with 6+ trades you average ${sign(r2(hAvg))}; on quiet days (3 or fewer) ${sign(r2(calm.reduce((s, d) => s + d.net, 0) / calm.length))}.`, tone: "bad", tab: "calendar" });
  }
  const fast = trades.filter((t) => Date.parse(t.closeTime + "Z") - Date.parse(t.openTime + "Z") <= 5 * 60_000);
  if (fast.length >= 10) {
    const fnet = r2(fast.reduce((s, t) => s + t.net, 0));
    out.push({ text: `${fast.length} trades lasted 5 minutes or less and netted ${sign(fnet)}.`, tone: fnet >= 0 ? "good" : "bad", tab: "trades" });
  }
  return out.slice(0, 5);
}
