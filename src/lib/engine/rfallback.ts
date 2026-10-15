import type { Trade } from "../types.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Many trades are entered without a stop and the stop is added right after. MT5 only records the
 * stop on the final position for those. For a trade with no stop-at-entry we use the position's
 * stop as the risk, but only when it still sits on the losing side of the entry (a stop moved to
 * or past break-even gives no meaningful risk, so the trade stays without R). Such trades are
 * marked rBasis "final" so the screens can say so.
 */
export function withFinalStopR(trades: Trade[]): Trade[] {
  const samples = new Map<string, number[]>();
  for (const t of trades) {
    const move = (t.closePrice - t.openPrice) * (t.side === "buy" ? 1 : -1);
    if (Math.abs(move) < 1e-9 || t.profit === 0) continue;
    const cs = t.profit / (move * t.volume);
    if (cs > 0) (samples.get(t.symbol) ?? samples.set(t.symbol, []).get(t.symbol)!).push(cs);
  }
  const size = new Map([...samples].map(([k, v]) => [k, median(v)]));
  return trades.map((t) => {
    if (t.rMultiple !== null) return { ...t, rBasis: "initial" as const };
    const cs = size.get(t.symbol);
    if (t.sl === null || !cs) return t;
    const dist = t.side === "buy" ? t.openPrice - t.sl : t.sl - t.openPrice;
    if (!(dist > 0)) return t;
    const riskMoney = r2(dist * t.volume * cs);
    return { ...t, riskMoney, rMultiple: riskMoney ? r2(t.net / riskMoney) : null, rBasis: "final" as const };
  });
}
