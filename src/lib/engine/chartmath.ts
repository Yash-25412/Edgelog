import type { Trade } from "../types.ts";
import { chooseTimeframe } from "./chartwindow.ts";
import { indexAt, toMs, type Series } from "./series.ts";

export const TF_CHOICES = [
  { tf: 1, label: "1m" }, { tf: 5, label: "5m" }, { tf: 15, label: "15m" }, { tf: 30, label: "30m" },
  { tf: 60, label: "1h" }, { tf: 240, label: "4h" }, { tf: 1440, label: "1D" },
] as const;

/** Round-number tick values covering [min, max], roughly `count` of them. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / Math.max(count, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export interface Box {
  tradeId: string;
  /** Candle index of entry and exit in the current series. */
  i0: number;
  i1: number;
  dir: 1 | -1;
  entry: number;
  exit: number;
  /** Final stop / target; null when the position never had one. */
  sl: number | null;
  tp: number | null;
  net: number;
  win: boolean;
}

/** The long/short position box for a trade on a given timeframe, or null if the candles do not cover it. */
export function boxFor(t: Trade, s: Series): Box | null {
  if (!s.n) return null;
  const a = toMs(t.openTime), b = toMs(t.closeTime);
  if (a < s.t[0] || a > s.t[s.n - 1] + s.tf * 60_000) return null;
  const i0 = indexAt(s, a);
  if (i0 < 0) return null;
  const i1 = Math.max(indexAt(s, b), i0);
  const dir = t.side === "buy" ? 1 : -1;
  // a stop on the wrong side of entry (moved past break-even) is not drawn as risk
  const sl = t.sl !== null && (t.openPrice - t.sl) * dir > 0 ? t.sl : null;
  const tp = t.tp !== null && (t.tp - t.openPrice) * dir > 0 ? t.tp : null;
  return { tradeId: t.dbId ?? t.externalId, i0, i1, dir, entry: t.openPrice, exit: t.closePrice, sl, tp, net: t.net, win: t.net > 0 };
}

/**
 * The view (candle index range, `to` exclusive) that frames a trade: the trade sits in the right
 * third so most of the room goes to what led up to it, with a little after it.
 */
export function viewForBox(box: Box, bars = 0): { from: number; to: number } {
  const len = box.i1 - box.i0 + 1;
  const visible = Math.max(bars || 0, 90, len * 3);
  const to = box.i1 + Math.max(len * 0.6, visible * 0.18);
  return { from: to - visible, to };
}

/** Timeframe that frames a trade nicely (same rule as the per-trade chart). */
export const tfForTrade = (t: Trade) => chooseTimeframe(t.openTime, t.closeTime);

export function clampView(v: { from: number; to: number }, n: number, minSpan = 12): { from: number; to: number } {
  let span = Math.max(v.to - v.from, minSpan);
  span = Math.min(span, Math.max(n * 1.6, minSpan));
  let from = v.from, to = from + span;
  const lo = -span * 0.5, hi = n + span * 0.3;
  if (from < lo) { from = lo; to = from + span; }
  if (to > hi) { to = hi; from = to - span; }
  return { from, to };
}
