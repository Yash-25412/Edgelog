"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dailyPnL } from "@/lib/engine/analytics";
import type { Trade } from "@/lib/types";
import { money, shortStamp } from "@/lib/format";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const cls = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function Calendar({ trades }: { trades: Trade[] }) {
  const days = useMemo(() => dailyPnL(trades), [trades]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const firstMonth = days[0]?.date.slice(0, 7) ?? "";
  const lastMonth = days.at(-1)?.date.slice(0, 7) ?? "";
  const [ym, setYm] = useState(lastMonth);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    setYm(lastMonth);
    setPicked(null);
  }, [lastMonth, firstMonth]);

  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday-first
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthDays = days.filter((d) => d.date.startsWith(ym));
  const monthNet = Math.round(monthDays.reduce((s, d) => s + d.net, 0) * 100) / 100;
  const monthTrades = monthDays.reduce((s, d) => s + d.trades, 0);
  const green = monthDays.filter((d) => d.net > 0).length;
  const red = monthDays.filter((d) => d.net < 0).length;
  const maxAbs = Math.max(1, ...monthDays.map((d) => Math.abs(d.net)));

  const dayTrades = picked ? trades.filter((t) => t.closeTime.slice(0, 10) === picked).sort((a, b) => (a.closeTime < b.closeTime ? -1 : 1)) : [];
  const dayInfo = picked ? byDate.get(picked) : undefined;

  return (
    <section className="card">
      <div className="cal-head">
        <button onClick={() => { setYm(shiftMonth(ym, -1)); setPicked(null); }} disabled={ym <= firstMonth} aria-label="Previous month">‹</button>
        <h2>{MONTHS[m - 1]} {y}</h2>
        <button onClick={() => { setYm(shiftMonth(ym, 1)); setPicked(null); }} disabled={ym >= lastMonth} aria-label="Next month">›</button>
        <span className="muted small cal-sum">
          <b className={cls(monthNet)}>{money(monthNet, true)}</b> · {monthTrades} trades · {green} green / {red} red days
        </span>
      </div>

      <div className="cal">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        <div className="cal-dow">Week</div>
        {weeks.map((w, wi) => {
          const weekNet = Math.round(w.reduce((s, d) => s + (d ? byDate.get(d)?.net ?? 0 : 0), 0) * 100) / 100;
          const weekCount = w.reduce((s, d) => s + (d ? byDate.get(d)?.trades ?? 0 : 0), 0);
          return [
            ...w.map((d, di) => {
              if (!d) return <div key={`${wi}-${di}`} className="cal-cell blank" />;
              const info = byDate.get(d);
              const alpha = info ? 0.14 + 0.5 * (Math.abs(info.net) / maxAbs) : 0;
              const bg = info ? (info.net >= 0 ? `rgba(45,212,168,${alpha})` : `rgba(255,107,107,${alpha})`) : undefined;
              return (
                <button
                  key={`${wi}-${di}`}
                  className={"cal-cell" + (picked === d ? " picked" : "") + (info ? "" : " idle")}
                  style={{ background: bg }}
                  disabled={!info}
                  onClick={() => setPicked(picked === d ? null : d)}
                  aria-label={info ? `${d}: ${money(info.net, true)}, ${info.trades} trades` : d}
                >
                  <span className="cal-day">{Number(d.slice(8))}</span>
                  {info && (
                    <>
                      <b className="cal-net">{money(info.net, true)}</b>
                      <small>{info.trades} {info.trades === 1 ? "trade" : "trades"}</small>
                    </>
                  )}
                </button>
              );
            }),
            <div key={`w${wi}`} className="cal-cell week">
              {weekCount > 0 && (
                <>
                  <b className={cls(weekNet)}>{money(weekNet, true)}</b>
                  <small>{weekCount} trades</small>
                </>
              )}
            </div>,
          ];
        })}
      </div>
      <p className="muted small">P&amp;L is counted on the day each trade closed, in broker time.</p>

      {picked && dayInfo && (
        <div className="day">
          <h2>
            {picked} · <span className={cls(dayInfo.net)}>{money(dayInfo.net, true)}</span>{" "}
            <span className="muted small">{dayInfo.wins} of {dayInfo.trades} won</span>
          </h2>
          <div className="scroll">
            <table>
              <thead><tr><th>Closed</th><th>Side</th><th className="r">Lots</th><th className="r">R</th><th className="r">Net</th><th /></tr></thead>
              <tbody>
                {dayTrades.map((t) => (
                  <tr key={t.externalId}>
                    <td>{shortStamp(t.closeTime)}</td>
                    <td>{t.side === "buy" ? "Long" : "Short"}</td>
                    <td className="r">{t.volume}</td>
                    <td className={"r " + cls(t.rMultiple ?? 0)}>{t.rMultiple === null ? "–" : t.rMultiple.toFixed(2)}</td>
                    <td className={"r " + cls(t.net)}>{money(t.net, true)}</td>
                    <td className="r">{t.dbId && <Link href={`/trades/${t.dbId}`}>Journal →</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
