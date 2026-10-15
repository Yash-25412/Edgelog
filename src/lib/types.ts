export type Cell = string | number | boolean | null;
export type Side = "buy" | "sell";
export type ExitReason = "sl" | "tp" | "stop_out" | "manual";

/** Naive timestamp exactly as the platform reports it: "YYYY-MM-DDTHH:mm:ss" (server time, no zone). */
export type Stamp = string;

export interface Fill {
  time: Stamp;
  price: number;
  volume: number;
  comment: string | null;
}

/** One closed position (a round trip) as reported by the platform. */
export interface Trade {
  /** Database row id. Only set for trades loaded from the database. */
  dbId?: string;
  /** Platform position id; unique per account. */
  externalId: string;
  symbol: string;
  side: Side;
  volume: number;
  openTime: Stamp;
  openPrice: number;
  /** Stop loss / take profit as last set on the position. */
  sl: number | null;
  tp: number | null;
  /** Stop loss / take profit when the entry order was placed (null if unknown). */
  initialSl: number | null;
  initialTp: number | null;
  closeTime: Stamp;
  /** Volume-weighted average exit price. */
  closePrice: number;
  commission: number;
  swap: number;
  /** Gross profit, before commission and swap. */
  profit: number;
  /** profit + commission + swap */
  net: number;
  /** Individual exit fills. More than one means the position was partially closed. */
  exits: Fill[];
  exitReason: ExitReason | null;
  /** Money risked at entry, from the initial stop. Null when there was no stop. */
  riskMoney: number | null;
  /** net / riskMoney. Null when riskMoney is null. */
  rMultiple: number | null;
  /** Which stop the risk came from: the one set at entry, or (fallback) the stop on the final position. */
  rBasis?: "initial" | "final";
}

export type LedgerKind = "entry" | "exit" | "deposit" | "withdrawal" | "credit" | "other";

/** One row of the platform's deal ledger (executions, plus balance operations). */
export interface LedgerRow {
  time: Stamp;
  dealId: string;
  kind: LedgerKind;
  symbol: string | null;
  side: Side | null;
  volume: number;
  price: number;
  commission: number;
  fee: number;
  swap: number;
  profit: number;
  /** Account balance after this row. */
  balance: number;
  comment: string | null;
}

export interface Mt5Report {
  platform: "mt5";
  accountName: string | null;
  company: string | null;
  generatedAt: Stamp | null;
  trades: Trade[];
  ledger: LedgerRow[];
  /** Balance before the first ledger row, inferred from the first row's balance. */
  startingBalance: number | null;
  endingBalance: number | null;
  /** Dollars (account currency) per 1.0 price move per 1.0 lot, inferred per symbol. */
  contractSizes: Record<string, number>;
  /** Anything unusual found while parsing. Never silently dropped. */
  warnings: string[];
}
