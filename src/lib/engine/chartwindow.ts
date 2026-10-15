import type { Stamp, Trade } from "../types.ts";
import type { Bar } from "../import/bars.ts";

/**
 * Picks the candle size and the 100-bar window for a trade's chart.
 *
 * Rule: use the smallest timeframe in which the trade spans at most MAX_TRADE_BARS bars,
 * show WINDOW_BARS bars in total, end the chart BARS_AFTER bars after the exit bar, and spend
 * everything else on the run-up before the entry. The run-up is what explains why the level
 * was marked, so it gets the room; what happened after the exit matters far less.
 * Bars are counted, not timed, so weekend gaps never leave a half-empty chart.
 */

export const TIMEFRAMES = [1, 5, 15, 30, 60, 240, 1440] as const; // minutes
export const WINDOW_BARS = 100;
export const MAX_TRADE_BARS = 40;
/** Candles shown after the exit candle. Kept short on purpose (5 to 10). */
export const BARS_AFTER = 8;

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

/** First index whose time is >= t. Bars must be sorted oldest first. */
function lowerBound(bars: Bar[], t: Stamp): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface ChartWindow {
  tfMinutes: number;
  candles: Bar[];
  /** Index (inside candles) of the bar containing the entry / exit. */
  entryIndex: number;
  exitIndex: number;
  /** True when the data did not reach back far enough for the full 100 bars. */
  truncated: boolean;
}

/** Null when the candle data does not cover the trade at all. */
export function chartWindow(trade: Pick<Trade, "openTime" | "closeTime">, m1: Bar[]): ChartWindow | null {
  // The price data must span the whole trade, otherwise the exit would be drawn on the wrong candle.
  if (!m1.length || m1[0].time > trade.openTime.slice(0, 16) + ":00" || m1[m1.length - 1].time < trade.closeTime.slice(0, 16) + ":00") return null;
  const tf = chooseTimeframe(trade.openTime, trade.closeTime);
  // Only the neighbourhood of the trade is rolled up, so a year of bars does not slow down every trade.
  // The start is aligned to a candle boundary so the first candle is never a partial one, and the
  // look-back is generous enough to cross a weekend gap.
  const span = tf * MIN;
  const lookback = Math.max(Math.ceil((WINDOW_BARS + 1) * span * 1.5), 5 * 24 * 60 * MIN);
  const startMs = Math.floor((ms(trade.openTime) - lookback) / span) * span;
  const endMs = ms(trade.closeTime) + (BARS_AFTER + 2) * span;
  const candles = aggregate(m1.slice(lowerBound(m1, stamp(startMs)), lowerBound(m1, stamp(endMs))), tf);
  if (!candles.length) return null;
  const entryStart = bucketStart(trade.openTime, tf);
  const exitStart = bucketStart(trade.closeTime, tf);
  // first candle at or after the entry bar, last candle at or before the exit bar
  const entryAt = candles.findIndex((c) => c.time >= entryStart);
  let exitAt = -1;
  for (let i = candles.length - 1; i >= 0; i--) if (candles[i].time <= exitStart) { exitAt = i; break; }
  if (entryAt === -1 || exitAt === -1 || candles[entryAt].time > exitStart || candles[exitAt].time < entryStart) return null;

  // End BARS_AFTER bars after the exit (or at the last candle we have), then fill backwards.
  // If the data does not reach back far enough the chart is shorter; it never borrows extra candles from after the trade.
  const to = Math.min(candles.length, exitAt + BARS_AFTER + 1); // exclusive
  const from = Math.max(0, to - WINDOW_BARS);
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
    const near = m1.slice(lowerBound(m1, stamp(t - 2 * MIN)), lowerBound(m1, stamp(t + 2 * MIN)));
    return near.some((b) => Math.abs(ms(b.time) - Math.floor(t / MIN) * MIN) <= MIN && b.low <= price && price <= b.high);
  };
  return { entryFits: fits(trade.openTime, trade.openPrice), exitFits: fits(trade.closeTime, trade.closePrice) };
}
