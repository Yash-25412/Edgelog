import type { Trade } from "../types.ts";

/**
 * Slice-and-dice analytics. Every function groups the same trades a different way,
 * so the buckets of any one view always add up to the same total.
 *
 * Times are the platform's server time, not your local time. Hour and weekday cuts
 * are therefore "broker time" cuts; the UI says so.
 */

export type Confidence = "very low" | "low" | "ok";

/** Small samples look like edges and are not. Thresholds are deliberately blunt. */
export function confidence(n: number): Confidence {
  return n < 10 ? "very low" : n < 30 ? "low" : "ok";
}

export interface Bucket {
  key: string;
  n: number;
  wins: number;
  winRate: number | null;
  net: number;
  /** Average net per trade. */
  expectancy: number | null;
  avgR: number | null;
  rTrades: number;
  confidence: Confidence;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Group trades by one or more keys each (a trade with two tags counts in both). Keeps first-seen order. */
export function bucketBy(trades: Trade[], keysOf: (t: Trade) => string[]): Bucket[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    for (const k of new Set(keysOf(t))) {
      const g = groups.get(k);
      if (g) g.push(t);
      else groups.set(k, [t]);
    }
  }
  return [...groups].map(([key, ts]) => {
    const wins = ts.filter((t) => t.net > 0).length;
    const net = ts.reduce((s, t) => s + t.net, 0);
    const withR = ts.filter((t) => t.rMultiple !== null);
    return {
      key,
      n: ts.length,
      wins,
      winRate: ts.length ? Math.round((wins / ts.length) * 1000) / 1000 : null,
      net: r2(net),
      expectancy: ts.length ? r2(net / ts.length) : null,
      avgR: withR.length ? r2(withR.reduce((s, t) => s + t.rMultiple!, 0) / withR.length) : null,
      rTrades: withR.length,
      confidence: confidence(ts.length),
    };
  });
}

export const hourOf = (t: Trade) => t.openTime.slice(11, 13);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday-first weekday name for a "YYYY-MM-DDTHH:mm:ss" stamp. */
export function weekdayOf(stamp: string): string {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7];
}

/** By entry hour (broker time), earliest hour first. Key is "09" meaning 09:00-09:59. */
export function byHour(trades: Trade[]): Bucket[] {
  return bucketBy(trades, (t) => [hourOf(t)]).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** By entry weekday (broker time), Monday first, only days that have trades. */
export function byWeekday(trades: Trade[]): Bucket[] {
  return bucketBy(trades, (t) => [weekdayOf(t.openTime)]).sort(
    (a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key),
  );
}

const EXIT_LABEL: Record<string, string> = { sl: "Stop loss", tp: "Take profit", stop_out: "Stop-out", manual: "Manual close" };

export function byExitReason(trades: Trade[]): Bucket[] {
  return bucketBy(trades, (t) => [EXIT_LABEL[t.exitReason ?? "manual"]]).sort((a, b) => b.n - a.n);
}

export const PLAN_ORDER = ["Stop & target", "Stop only", "Target only", "Neither"];
export const TIMING_ORDER = ["Set at entry", "Added after entry", "Never set"];
const order = (keys: string[]) => (a: { key: string }, b: { key: string }) => keys.indexOf(a.key) - keys.indexOf(b.key);

/** A trade is "defined" if a stop or target existed at any point (it is common to add them after a limit order fills). */
export function byPlan(trades: Trade[]): Bucket[] {
  return bucketBy(trades, (t) => [
    t.sl !== null && t.tp !== null ? "Stop & target" : t.sl !== null ? "Stop only" : t.tp !== null ? "Target only" : "Neither",
  ]).sort(order(PLAN_ORDER));
}

/** When the stop/target was put on: with the order, after the entry filled, or never. Both of the first two count as defined. */
export function byPlanTiming(trades: Trade[]): Bucket[] {
  return bucketBy(trades, (t) => [
    t.initialSl !== null || t.initialTp !== null ? "Set at entry" : t.sl !== null || t.tp !== null ? "Added after entry" : "Never set",
  ]).sort(order(TIMING_ORDER));
}
/** Trades per direction of position size relative to the account's typical size. */
export function bySide(trades: Trade[]): Bucket[] {
  return bucketBy(trades, (t) => [t.side === "buy" ? "Long" : "Short"]);
}

export interface Day {
  /** "YYYY-MM-DD" of the close. Realised P&L is counted on the day the trade closes. */
  date: string;
  net: number;
  trades: number;
  wins: number;
}

export function dailyPnL(trades: Trade[]): Day[] {
  const days = new Map<string, Day>();
  for (const t of trades) {
    const date = t.closeTime.slice(0, 10);
    const d = days.get(date) ?? { date, net: 0, trades: 0, wins: 0 };
    d.net += t.net;
    d.trades += 1;
    if (t.net > 0) d.wins += 1;
    days.set(date, d);
  }
  return [...days.values()].map((d) => ({ ...d, net: r2(d.net) })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
