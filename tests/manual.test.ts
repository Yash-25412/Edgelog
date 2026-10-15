import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManualTrade } from "../src/lib/manual.ts";

const base = { symbol: "xauusd", side: "sell" as const, volume: 0.02, openTime: "2026-10-07T10:00", openPrice: 4120.52, closeTime: "2026-10-07T10:30", closePrice: 4089.78, profit: 61.48 };

test("builds a trade like an import would", () => {
  const t = buildManualTrade({ ...base, commission: -0.15, sl: 4130.52 }, "manual-1");
  assert.equal(t.symbol, "XAUUSD");
  assert.equal(t.net, 61.33);
  assert.equal(t.openTime, "2026-10-07T10:00:00");
  assert.equal(t.riskMoney, 20); // 10 points x 0.02 x 100
  assert.equal(t.rMultiple, 3.07);
});
test("no stop means no R, never a guess", () => {
  const t = buildManualTrade(base, "m");
  assert.equal(t.rMultiple, null);
  assert.equal(t.riskMoney, null);
});
test("rejects a profit sign that contradicts the prices", () => {
  assert.throws(() => buildManualTrade({ ...base, profit: -61 }, "m"), /should be a profit/);
});
test("rejects bad times and volume", () => {
  assert.throws(() => buildManualTrade({ ...base, closeTime: "2026-10-07T09:00" }, "m"), /before the entry/);
  assert.throws(() => buildManualTrade({ ...base, volume: 0 }, "m"), /Volume/);
});
