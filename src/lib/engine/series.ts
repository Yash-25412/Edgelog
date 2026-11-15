import type { Bar } from "../import/bars.ts";

/** Candles as parallel typed arrays: cheap to hold hundreds of thousands of 1-minute bars in memory. */
export interface Series {
  /** Minutes per candle. */
  tf: number;
  /** Candle start, ms since epoch, reading the broker clock as if it were UTC (never shifted). */
  t: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
  n: number;
}

const MIN = 60_000;
export const toMs = (stamp: string) => Date.parse(stamp + "Z");
export const toStamp = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export function seriesFromBars(bars: Bar[], tf = 1): Series {
  const n = bars.length;
  const s: Series = { tf, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), n };
  bars.forEach((b, i) => {
    s.t[i] = toMs(b.time);
    s.o[i] = b.open; s.h[i] = b.high; s.l[i] = b.low; s.c[i] = b.close; s.v[i] = b.tickVolume;
  });
  return s;
}

/** Same bucketing as chartwindow.aggregate (broker-midnight aligned), on typed arrays. */
export function resample(src: Series, tf: number): Series {
  if (tf === src.tf) return src;
  const span = tf * MIN;
  const t: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  let last = -1;
  for (let i = 0; i < src.n; i++) {
    const start = Math.floor(src.t[i] / span) * span;
    if (start === last) {
      const k = t.length - 1;
      if (src.h[i] > h[k]) h[k] = src.h[i];
      if (src.l[i] < l[k]) l[k] = src.l[i];
      c[k] = src.c[i];
      v[k] += src.v[i];
    } else {
      t.push(start); o.push(src.o[i]); h.push(src.h[i]); l.push(src.l[i]); c.push(src.c[i]); v.push(src.v[i]);
      last = start;
    }
  }
  return { tf, t: Float64Array.from(t), o: Float64Array.from(o), h: Float64Array.from(h), l: Float64Array.from(l), c: Float64Array.from(c), v: Float64Array.from(v), n: t.length };
}

/** Index of the last candle starting at or before `ms`; -1 when `ms` is before the first candle. */
export function indexAt(s: Series, ms: number): number {
  let lo = 0, hi = s.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Merge candle lists by time (later list wins on equal times). Used when a day is uploaded twice. */
export function mergeBars(a: Bar[], b: Bar[]): Bar[] {
  const m = new Map<string, Bar>();
  for (const x of a) m.set(x.time, x);
  for (const x of b) m.set(x.time, x);
  return [...m.values()].sort((p, q) => (p.time < q.time ? -1 : p.time > q.time ? 1 : 0));
}

/** Split bars into per-day chunks keyed "YYYY-MM-DD" (broker date). */
export function groupByDay(bars: Bar[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = b.time.slice(0, 10);
    (out.get(d) ?? out.set(d, []).get(d)!).push(b);
  }
  return out;
}

/** Compact storage for one day: [minuteOfDay, open, high, low, close, tickVolume]. */
export type DayRow = [number, number, number, number, number, number];
export const packDay = (bars: Bar[]): DayRow[] =>
  bars.map((b) => [Number(b.time.slice(11, 13)) * 60 + Number(b.time.slice(14, 16)), b.open, b.high, b.low, b.close, b.tickVolume]);
export function unpackDay(day: string, rows: DayRow[]): Bar[] {
  return rows.map(([m, open, high, low, close, tickVolume]) => ({
    time: `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`,
    open, high, low, close, tickVolume,
  }));
}
