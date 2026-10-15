import type { Fill, LedgerRow, Trade } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function tradeToRow(t: Trade, userId: string, accountId: string) {
  return {
    user_id: userId,
    account_id: accountId,
    external_id: t.externalId,
    symbol: t.symbol,
    side: t.side,
    volume: t.volume,
    open_time: t.openTime,
    open_price: t.openPrice,
    sl: t.sl,
    tp: t.tp,
    initial_sl: t.initialSl,
    initial_tp: t.initialTp,
    close_time: t.closeTime,
    close_price: t.closePrice,
    commission: t.commission,
    swap: t.swap,
    profit: t.profit,
    net: t.net,
    exit_reason: t.exitReason,
    risk_money: t.riskMoney,
    r_multiple: t.rMultiple,
    exits: t.exits as Fill[],
  };
}

export function ledgerToRow(l: LedgerRow, userId: string, accountId: string) {
  return {
    user_id: userId,
    account_id: accountId,
    deal_id: l.dealId,
    time: l.time,
    kind: l.kind,
    symbol: l.symbol,
    side: l.side,
    volume: l.volume,
    price: l.price,
    commission: l.commission,
    fee: l.fee,
    swap: l.swap,
    profit: l.profit,
    balance: l.balance,
    comment: l.comment,
  };
}

const n = (v: any) => (v === null || v === undefined ? null : Number(v));

export function rowToTrade(r: any): Trade {
  return {
    dbId: r.id,
    externalId: r.external_id,
    symbol: r.symbol,
    side: r.side,
    volume: Number(r.volume),
    openTime: r.open_time,
    openPrice: Number(r.open_price),
    sl: n(r.sl),
    tp: n(r.tp),
    initialSl: n(r.initial_sl),
    initialTp: n(r.initial_tp),
    closeTime: r.close_time,
    closePrice: Number(r.close_price),
    commission: Number(r.commission),
    swap: Number(r.swap),
    profit: Number(r.profit),
    net: Number(r.net),
    exits: r.exits ?? [],
    exitReason: r.exit_reason,
    riskMoney: n(r.risk_money),
    rMultiple: n(r.r_multiple),
  };
}
