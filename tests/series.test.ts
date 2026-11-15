import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMt5Bars } from "../src/lib/import/bars.ts";
import { aggregate, TIMEFRAMES } from "../src/lib/engine/chartwindow.ts";
import { groupByDay, indexAt, mergeBars, packDay, resample, seriesFromBars, toMs, unpackDay } from "../src/lib/engine/series.ts";
import { boxFor, clampView, niceTicks, viewForBox } from "../src/lib/engine/chartmath.ts";
import type { Trade } from "../src/lib/types.ts";

const { bars } = parseMt5Bars(readFileSync(new URL("./fixtures/xauusd-m1-2026-09-25.csv", import.meta.url), "utf8"));
const m1 = seriesFromBars(bars);

test("typed resample equals the existing aggregate for every timeframe", () => {
  for (const tf of TIMEFRAMES) {
    const a = aggregate(bars, tf), b = resample(m1, tf);
    assert.equal(b.n, a.length, `tf ${tf}`);
    a.forEach((x, i) => {
      assert.equal(b.t[i], toMs(x.time));
      assert.equal(b.o[i], x.open); assert.equal(b.h[i], x.high); assert.equal(b.l[i], x.low); assert.equal(b.c[i], x.close); assert.equal(b.v[i], x.tickVolume);
    });
  }
});

test("indexAt finds the candle containing a time", () => {
  const s = resample(m1, 15);
  const mid = s.t[5] + 7 * 60_000;
  assert.equal(indexAt(s, mid), 5);
  assert.equal(indexAt(s, s.t[0] - 1), -1);
  assert.equal(indexAt(s, s.t[s.n - 1] + 1e9), s.n - 1);
});

test("day packing round-trips and merging keeps the later copy", () => {
  const days = groupByDay(bars);
  for (const [d, list] of days) assert.deepEqual(unpackDay(d, packDay(list)), list);
  const a = bars.slice(0, 10), b = bars.slice(5, 15).map((x) => ({ ...x, close: x.close + 1 }));
  const m = mergeBars(a, b);
  assert.equal(m.length, 15);
  assert.equal(m[7].close, b[2].close);
});

const trade = (over: Partial<Trade>): Trade => ({
  externalId: "x", dbId: "d1", symbol: "XAUUSD", side: "buy", volume: 0.01, openTime: bars[20].time, openPrice: bars[20].open,
  sl: bars[20].open - 5, tp: bars[20].open + 8, initialSl: null, initialTp: null, closeTime: bars[60].time, closePrice: bars[60].close,
  commission: 0, swap: 0, profit: 1, net: 1, exits: [], exitReason: "manual", riskMoney: null, rMultiple: null, ...over,
});

test("position boxes land on the right candles; wrong-side stops are not drawn", () => {
  const b = boxFor(trade({}), m1)!;
  assert.equal(b.i0, 20); assert.equal(b.i1, 60); assert.equal(b.dir, 1);
  assert.equal(boxFor(trade({ sl: bars[20].open + 1 }), m1)!.sl, null);
  const short = boxFor(trade({ side: "sell", sl: bars[20].open + 5, tp: bars[20].open - 8 }), m1)!;
  assert.equal(short.dir, -1); assert.equal(short.tp, bars[20].open - 8);
  assert.equal(boxFor(trade({ openTime: "2020-01-01T00:00:00" }), m1), null);
  const h1 = resample(m1, 60);
  const hb = boxFor(trade({}), h1)!;
  assert.ok(hb.i1 >= hb.i0);
});

test("view framing and tick helpers", () => {
  const b = boxFor(trade({}), m1)!;
  const v = viewForBox(b);
  assert.ok(v.to > b.i1 && v.from < b.i0);
  const c = clampView({ from: -500, to: -400 }, 100);
  assert.ok(c.to - c.from >= 12 && c.from >= -(c.to - c.from) * 0.5 - 1e-9);
  assert.deepEqual(niceTicks(4000, 4050, 5), [4000, 4010, 4020, 4030, 4040, 4050]);
});
