import type { ExitReason, Side, Trade } from "./types.ts";

export interface ManualInput {
  symbol: string;
  side: Side;
  volume: number;
  openTime: string; // "YYYY-MM-DDTHH:mm" or with seconds
  openPrice: number;
  closeTime: string;
  closePrice: number;
  /** Gross profit/loss in account money, before fees. Entered by the trader (we never guess the contract size). */
  profit: number;
  commission?: number;
  swap?: number;
  sl?: number | null;
  tp?: number | null;
  exitReason?: ExitReason | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const stamp = (s: string) => (s.length === 16 ? s + ":00" : s);

/** Validate a hand-typed trade and turn it into the same Trade shape an import produces. */
export function buildManualTrade(i: ManualInput, id: string): Trade {
  const symbol = i.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Enter the symbol, e.g. XAUUSD.");
  if (!(i.volume > 0)) throw new Error("Volume must be more than 0.");
  if (!(i.openPrice > 0) || !(i.closePrice > 0)) throw new Error("Entry and exit prices must be more than 0.");
  if (!Number.isFinite(i.profit)) throw new Error("Enter the profit or loss in money (negative for a loss).");
  const open = stamp(i.openTime), close = stamp(i.closeTime);
  if (Number.isNaN(Date.parse(open + "Z")) || Number.isNaN(Date.parse(close + "Z"))) throw new Error("Enter both the entry and exit date and time.");
  if (close < open) throw new Error("The exit time is before the entry time.");

  const dir = i.side === "buy" ? 1 : -1;
  const move = (i.closePrice - i.openPrice) * dir;
  if (move !== 0 && Math.sign(move) !== Math.sign(i.profit) && i.profit !== 0) {
    throw new Error(`For a ${i.side === "buy" ? "buy" : "sell"} from ${i.openPrice} to ${i.closePrice} the result should be ${move > 0 ? "a profit" : "a loss"}. Check the side and the profit sign.`);
  }
  const commission = i.commission ?? 0, swap = i.swap ?? 0;
  const net = r2(i.profit + commission + swap);

  // money per 1.0 price move per lot, from this trade itself (same method as the MT5 import)
  const sl = i.sl ?? null;
  let riskMoney: number | null = null;
  if (sl !== null && move !== 0) {
    const perUnit = Math.abs(i.profit / (move * i.volume));
    const stopMove = (i.openPrice - sl) * dir;
    if (stopMove > 0) riskMoney = r2(stopMove * i.volume * perUnit);
  }
  return {
    externalId: id,
    symbol,
    side: i.side,
    volume: i.volume,
    openTime: open,
    openPrice: i.openPrice,
    sl,
    tp: i.tp ?? null,
    initialSl: sl,
    initialTp: i.tp ?? null,
    closeTime: close,
    closePrice: i.closePrice,
    commission,
    swap,
    profit: r2(i.profit),
    net,
    exits: [{ time: close, price: i.closePrice, volume: i.volume, comment: "manual entry" }],
    exitReason: i.exitReason ?? null,
    riskMoney,
    rMultiple: riskMoney ? r2(net / riskMoney) : null,
  };
}
