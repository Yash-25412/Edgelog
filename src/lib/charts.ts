import type { Bar } from "./import/bars.ts";
import type { ChartWindow } from "./engine/chartwindow.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Candles are stored as compact arrays: [time, open, high, low, close, tickVolume]. */
export type PackedCandle = [string, number, number, number, number, number];

export const packCandles = (bars: Bar[]): PackedCandle[] =>
  bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.tickVolume]);

export const unpackCandles = (rows: PackedCandle[]): Bar[] =>
  rows.map(([time, open, high, low, close, tickVolume]) => ({ time, open, high, low, close, tickVolume }));

export function chartToRow(w: ChartWindow, tradeId: string, userId: string, source = "mt5-bars") {
  return {
    trade_id: tradeId,
    user_id: userId,
    tf_minutes: w.tfMinutes,
    candles: packCandles(w.candles),
    entry_index: w.entryIndex,
    exit_index: w.exitIndex,
    truncated: w.truncated,
    source,
  };
}

export function rowToChart(r: any): ChartWindow {
  return {
    tfMinutes: Number(r.tf_minutes),
    candles: unpackCandles(r.candles ?? []),
    entryIndex: Number(r.entry_index),
    exitIndex: Number(r.exit_index),
    truncated: !!r.truncated,
  };
}
