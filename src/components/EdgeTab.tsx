"use client";

import { useMemo } from "react";
import {
  bucketBy, byExitReason, byHour, byPlan, byPlanTiming, byWeekday, type Bucket,
} from "@/lib/engine/analytics";
import { EMOTIONS, type Journal } from "@/lib/journal";
import type { Trade } from "@/lib/types";
import { money, num2, pct } from "@/lib/format";

const cls = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "pos" : "neg");

function Bars({ title, note, rows, label }: { title: string; note?: string; rows: Bucket[]; label?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const best = rows.length ? rows.reduce((a, b) => (b.net > a.net ? b : a)).key : null;
  const worst = rows.length ? rows.reduce((a, b) => (b.net < a.net ? b : a)).key : null;
  return (
    <section className="card">
      <h2>{title}</h2>
      {note && <p className="muted small bars-note">{note}</p>}
      {rows.length === 0 ? (
        <p className="muted small">Nothing here yet.</p>
      ) : (
        <div className="bars">
          <div className="bars-row bars-head">
            <span />
            <span>Net P&amp;L</span>
            <span className="r">Trades</span>
            <span className="r">Win</span>
            <span className="r">Avg R</span>
          </div>
          {rows.map((r, idx) => {
            const w = (Math.abs(r.net) / max) * 50;
            return (
              <div key={r.key} className={"bars-row hov" + (r.confidence === "very low" ? " faint" : "") + (r.key === best && r.net > 0 ? " glow-up" : "") + (r.key === worst && r.net < 0 ? " glow-down" : "")}>
                <span className="bars-label">{label ? label(r.key) : r.key}</span>
                <span className="bars-track" title={`${money(r.net, true)} over ${r.n} trades`}>
                  <i className="bars-mid" />
                  <i className={"bars-bar " + (r.net >= 0 ? "up" : "down")} style={{ ...(r.net >= 0 ? { left: "50%", width: `${w}%`, transformOrigin: "left" } : { left: `${50 - w}%`, width: `${w}%`, transformOrigin: "right" }), animationDelay: `${idx * 45}ms` }} />
                  <b className={"bars-val " + cls(r.net)}>{money(r.net, true)}</b>
                </span>
                <span className="r">
                  {r.n}
                  {r.confidence !== "ok" && <em className="conf" title="Small sample: treat as a question, not a conclusion">{r.confidence}</em>}
                </span>
                <span className="r">{pct(r.winRate)}</span>
                <span className="r">{r.avgR === null ? "–" : num2(r.avgR)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function EdgeTab({ trades, journal }: { trades: Trade[]; journal: Map<string, Journal> | null }) {
  const plan = useMemo(() => byPlan(trades), [trades]);
  const timing = useMemo(() => byPlanTiming(trades), [trades]);
  const exits = useMemo(() => byExitReason(trades), [trades]);
  const weekday = useMemo(() => byWeekday(trades), [trades]);
  const hour = useMemo(() => byHour(trades), [trades]);

  const jOf = (t: Trade) => (t.dbId && journal ? journal.get(t.dbId) : undefined);
  const mistakes = useMemo(() => bucketBy(trades, (t) => jOf(t)?.mistakes ?? []).sort((a, b) => a.net - b.net), [trades, journal]); // eslint-disable-line react-hooks/exhaustive-deps
  const setups = useMemo(() => bucketBy(trades, (t) => { const s = jOf(t)?.setup; return s ? [s] : []; }).sort((a, b) => b.net - a.net), [trades, journal]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => bucketBy(trades, (t) => jOf(t)?.tags ?? []).sort((a, b) => b.n - a.n), [trades, journal]); // eslint-disable-line react-hooks/exhaustive-deps
  const emotions = useMemo(
    () => bucketBy(trades, (t) => { const e = jOf(t)?.emotion; return e ? [String(e)] : []; }).sort((a, b) => Number(a.key) - Number(b.key)),
    [trades, journal], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const journaled = journal ? trades.filter((t) => t.dbId && journal.has(t.dbId)).length : 0;

  return (
    <>
      <div className="notice info">
        These cuts are for finding questions, not answers. Anything marked <em className="conf">low</em> or <em className="conf">very low</em> rests on too few
        trades to trust. Hours and weekdays are broker (server) time, by entry.
      </div>

      <section className="card">
        <h2>Risk plan defined</h2>
        <p className="muted small bars-note">A trade counts as defined if it had a stop loss or take profit at any point, including ones added after a limit order filled.</p>
        <div className="grid2 tight">
          {plan.map((b) => (
            <div key={b.key} className="kpi">
              <span>{b.key}</span>
              <b className={cls(b.net)}>{money(b.net, true)}</b>
              <small>
                {b.n} trades · {pct(b.winRate)} won · {b.avgR === null ? "no R available" : `avg ${num2(b.avgR)}R`}
                {b.confidence !== "ok" && ` · ${b.confidence} confidence`}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>When the plan was added</h2>
        <p className="muted small bars-note">Set with the order, added after the entry filled, or never. The first two both count as defined; this only shows whether the timing changes results.</p>
        <div className="grid2 tight">
          {timing.map((b) => (
            <div key={b.key} className="kpi">
              <span>{b.key}</span>
              <b className={cls(b.net)}>{money(b.net, true)}</b>
              <small>
                {b.n} trades · {pct(b.winRate)} won · {b.avgR === null ? "no R available" : `avg ${num2(b.avgR)}R`}
                {b.confidence !== "ok" && ` · ${b.confidence} confidence`}
              </small>
            </div>
          ))}
        </div>
      </section>

      <Bars title="By exit type" note="How each trade ended. Stop-loss exits that won are stops that had moved into profit." rows={exits} />
      <Bars title="By weekday" rows={weekday} />
      <Bars title="By entry hour" note="Hour the trade was opened, broker time (hour 09 = 09:00 to 09:59)." rows={hour} label={(k) => `${k}:00`} />

      <h2 className="section-title">From your journal</h2>
      {journal === null ? (
        <div className="notice">The journal isn&apos;t switched on yet. Run <b>0002_journal.sql</b> in Supabase to enable notes, tags and mistakes.</div>
      ) : journaled === 0 ? (
        <div className="notice info">
          Nothing journaled yet. Open any trade, tag a setup, mistakes and how you felt, and these cuts will appear here.
        </div>
      ) : (
        <>
          <p className="muted small">{journaled} of {trades.length} trades have journal entries. Only those are counted below.</p>
          <Bars title="By mistake" note="Worst first. This is what your mistakes cost." rows={mistakes} />
          <Bars title="By setup" rows={setups} />
          <Bars title="By tag" rows={tags} />
          <Bars title="By emotional state" note="1 = calm, 5 = tilted." rows={emotions} label={(k) => `${k} · ${EMOTIONS[Number(k) - 1] ?? ""}`} />
        </>
      )}
    </>
  );
}
