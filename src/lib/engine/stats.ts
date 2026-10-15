import type { LedgerRow, Trade } from "../types.ts";

export interface Drawdown {
  /** Start balance minus the lowest balance reached (0 if never below start). */
  absolute: number;
  /** Largest peak-to-trough drop in money, and that drop as % of its peak. */
  maximal: { amount: number; percent: number };
  /** Largest peak-to-trough drop in percent, and that drop in money. */
  relative: { percent: number; amount: number };
}

export interface SideStats {
  count: number;
  wins: number;
  winRate: number | null;
  net: number;
}

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / trades, 0..1. Null with no trades. */
  winRate: number | null;
  net: number;
  grossProfit: number;
  grossLoss: number;
  commission: number;
  swap: number;
  /** Null when there are no losses (undefined, not infinite). */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** avgWin / |avgLoss| */
  payoff: number | null;
  /** Average net per trade. */
  expectancy: number | null;
  /** Average R over trades that had an initial stop; rTrades says how many. */
  avgR: number | null;
  rTrades: number;
  largestWin: number | null;
  largestLoss: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgHoldSeconds: number | null;
  long: SideStats;
  short: SideStats;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const secs = (stamp: string) => Date.parse(stamp + "Z") / 1000;

function sideStats(ts: Trade[]): SideStats {
  const wins = ts.filter((t) => t.net > 0).length;
  return {
    count: ts.length,
    wins,
    winRate: ts.length ? r4(wins / ts.length) : null,
    net: r2(ts.reduce((s, t) => s + t.net, 0)),
  };
}

/** Trade-level statistics. A win is net > 0 after commission and swap. */
export function summarize(trades: Trade[]): Summary {
  const byClose = [...trades].sort((a, b) => (a.closeTime < b.closeTime ? -1 : a.closeTime > b.closeTime ? 1 : 0));
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net < 0);
  const grossProfit = wins.reduce((s, t) => s + t.net, 0);
  const grossLoss = losses.reduce((s, t) => s + t.net, 0);
  const n = trades.length;
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const withR = trades.filter((t) => t.rMultiple !== null);

  let w = 0, l = 0, maxW = 0, maxL = 0;
  for (const t of byClose) {
    if (t.net > 0) { w++; l = 0; } else if (t.net < 0) { l++; w = 0; } else { w = 0; l = 0; }
    maxW = Math.max(maxW, w);
    maxL = Math.max(maxL, l);
  }

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    breakeven: n - wins.length - losses.length,
    winRate: n ? r4(wins.length / n) : null,
    net: r2(trades.reduce((s, t) => s + t.net, 0)),
    grossProfit: r2(grossProfit),
    grossLoss: r2(grossLoss),
    commission: r2(trades.reduce((s, t) => s + t.commission, 0)),
    swap: r2(trades.reduce((s, t) => s + t.swap, 0)),
    profitFactor: grossLoss < 0 ? r4(grossProfit / -grossLoss) : null,
    avgWin: avgWin === null ? null : r2(avgWin),
    avgLoss: avgLoss === null ? null : r2(avgLoss),
    payoff: avgWin !== null && avgLoss !== null && avgLoss < 0 ? r4(avgWin / -avgLoss) : null,
    expectancy: n ? r2(trades.reduce((s, t) => s + t.net, 0) / n) : null,
    avgR: withR.length ? r2(withR.reduce((s, t) => s + t.rMultiple!, 0) / withR.length) : null,
    rTrades: withR.length,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.net)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.net)) : null,
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    avgHoldSeconds: n ? Math.round(trades.reduce((s, t) => s + (secs(t.closeTime) - secs(t.openTime)), 0) / n) : null,
    long: sideStats(trades.filter((t) => t.side === "buy")),
    short: sideStats(trades.filter((t) => t.side === "sell")),
  };
}

/** Drawdown over a balance series (include the starting balance as the first point). */
export function drawdown(balances: number[]): Drawdown {
  if (!balances.length) return { absolute: 0, maximal: { amount: 0, percent: 0 }, relative: { percent: 0, amount: 0 } };
  const start = balances[0];
  let peak = start;
  let min = start;
  let maxAmt = 0, maxAmtPct = 0, relPct = 0, relAmt = 0;
  for (const b of balances) {
    min = Math.min(min, b);
    if (b > peak) peak = b;
    const amt = peak - b;
    const pct = peak > 0 ? (amt / peak) * 100 : 0;
    if (amt > maxAmt) { maxAmt = amt; maxAmtPct = pct; }
    if (pct > relPct) { relPct = pct; relAmt = amt; }
  }
  return {
    absolute: r2(Math.max(0, start - min)),
    maximal: { amount: r2(maxAmt), percent: r2(maxAmtPct) },
    relative: { percent: r2(relPct), amount: r2(relAmt) },
  };
}

/** Balance after every ledger row, starting from the starting balance. */
export function balanceSeries(startingBalance: number, ledger: LedgerRow[]): number[] {
  return [startingBalance, ...ledger.map((l) => l.balance)];
}

export interface CurvePoint {
  time: string;
  balance: number;
  tradeId: string;
}

/** Closed-trade equity curve: balance after each trade closes (deposits ignored). */
export function equityCurve(startingBalance: number, trades: Trade[]): CurvePoint[] {
  const sorted = [...trades].sort((a, b) => (a.closeTime < b.closeTime ? -1 : a.closeTime > b.closeTime ? 1 : 0));
  let bal = startingBalance;
  return sorted.map((t) => {
    bal = r2(bal + t.net);
    return { time: t.closeTime, balance: bal, tradeId: t.externalId };
  });
}
