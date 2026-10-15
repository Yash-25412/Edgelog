import type { Stamp, Trade } from "../types.ts";
import type { Bar } from "../import/bars.ts";

/**
 * Picks the candle size and the 100-bar window for a trade's chart.
 *
 * Rule: use the smallest timeframe in which the trade spans at most MAX_TRADE_BARS bars,
 * then show WINDOW_BARS bars with BARS_BEFORE bars of context before the entry bar.
 * Whatever is left of the 100 bars shows what happened after the exit.
 * Bars are counted, not timed, so weekend gaps never leave a half-empty chart.
 */

export const TIMEFRAMES = [1, 5, 15, 30, 60, 240, 1440] as const; // minutes
export const WINDOW_BARS = 100;
export const MAX_TRADE_BARS = 40;
export const BARS_BEFORE = 30;

const MIN = 60_000;
const ms = (s: Stamp) => Date.parse(s + "Z");
const stamp = (t: number) => new Date(t).toISOString().slice(0, 19);

/** Start of the bar that contains `s`, for a timeframe in minutes (broker clock, midnight aligned). */
export function bucketStart(s: Stamp, tf: number): Stamp {
  const t = ms(s);
  return stamp(Math.floor(t / (tf * MIN)) * (tf * MIN));
}

/** Smallest timeframe where the trade covers at most MAX_TRADE_BARS bars. Falls back to daily. */
export function chooseTimeframe(openTime: Stamp, closeTime: Stamp): number {
  const open = ms(openTime), close = ms(closeTime);
  for (const tf of TIMEFRAMES) {
    const span = tf * MIN;
    const bars = Math.floor(close / span) - Math.floor(open / span) + 1;
    if (bars <= MAX_TRADE_BARS) return tf;
  }
  return TIMEFRAMES[TIMEFRAMES.length - 1];
}

/** Build tf-minute candles from 1-minute bars. Empty minutes simply produce no candle. */
export function aggregate(m1: Bar[], tf: number): Bar[] {
  if (tf === 1) return m1;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of m1) {
    const start = bucketStart(b.time, tf);
    if (cur && cur.time === start) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.tickVolume += b.tickVolume;
    } else {
      cur = { time: start, open: b.open, high: b.high, low: b.low, close: b.close, tickVolume: b.tickVolume };
      out.push(cur);
    }
  }
  return out;
}

export interface ChartWindow {
  tfMinutes: number;
  candles: Bar[];
  /** Index (inside candles) of the bar containing the entry / exit. */
  entryIndex: number;
  exitIndex: number;
  /** True when the data did not reach back or forward far enough for the full 100 bars. */
  truncated: boolean;
}

/** Null when the candle data does not cover the trade at all. */
export function chartWindow(trade: Pick<Trade, "openTime" | "closeTime">, m1: Bar[]): ChartWindow | null {
  const tf = chooseTimeframe(trade.openTime, trade.closeTime);
  const candles = aggregate(m1, tf);
  if (!candles.length) return null;
  const entryStart = bucketStart(trade.openTime, tf);
  const exitStart = bucketStart(trade.closeTime, tf);
  // first candle at or after the entry bar, last candle at or before the exit bar
  const entryAt = candles.findIndex((c) => c.time >= entryStart);
  let exitAt = -1;
  for (let i = candles.length - 1; i >= 0; i--) if (candles[i].time <= exitStart) { exitAt = i; break; }
  if (entryAt === -1 || exitAt === -1 || candles[entryAt].time > exitStart || candles[exitAt].time < entryStart) return null;

  let from = entryAt - BARS_BEFORE;
  let to = from + WINDOW_BARS; // exclusive
  if (to > candles.length) { to = candles.length; from = Math.max(0, to - WINDOW_BARS); }
  if (from < 0) { from = 0; to = Math.min(candles.length, WINDOW_BARS); }
  const slice = candles.slice(from, to);
  return {
    tfMinutes: tf,
    candles: slice,
    entryIndex: entryAt - from,
    exitIndex: exitAt - from,
    truncated: slice.length < WINDOW_BARS,
  };
}

export interface Alignment {
  entryFits: boolean;
  exitFits: boolean;
}

/**
 * Sanity check before showing any chart: did the entry and exit prices trade inside the
 * 1-minute bar that contains their timestamp (or an adjacent minute, for fills right on a boundary)?
 * If not, the candles are from another feed or another clock and the chart would mislead.
 */
export function alignment(trade: Pick<Trade, "openTime" | "closeTime" | "openPrice" | "closePrice">, m1: Bar[]): Alignment {
  const fits = (time: Stamp, price: number) => {
    const t = ms(time);
    return m1.some((b) => Math.abs(ms(b.time) - Math.floor(t / MIN) * MIN) <= MIN && b.low <= price && price <= b.high);
  };
  return { entryFits: fits(trade.openTime, trade.openPrice), exitFits: fits(trade.closeTime, trade.closePrice) };
}
