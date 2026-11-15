"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { boxFor, clampView, niceTicks, TF_CHOICES, tfForTrade, viewForBox, type Box } from "@/lib/engine/chartmath";
import { resample, type Series } from "@/lib/engine/series";
import type { Trade } from "@/lib/types";

const UP = "#2dd4a8", DOWN = "#ff6b6b", BG = "#0e1116", GRID = "rgba(255,255,255,.06)", TEXT = "#9aa4b2", AX = 76, AY = 26;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STEPS = [1, 5, 10, 15, 30, 60, 120, 240, 720, 1440, 2880, 10080, 43200];

export interface Jump { id: string; n: number }

const p2 = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => { const d = new Date(ms); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const dmy = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const full = (ms: number) => { const d = new Date(ms); return `${dmy(ms)} ${d.getUTCFullYear()} ${clock(ms)}`; };

export function LiveChart({
  m1, symbol, trades, selectedId, onSelect, jump, initialTf = 15,
}: {
  m1: Series;
  symbol: string;
  trades: Trade[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  jump: Jump | null;
  initialTf?: number;
}) {
  const [tf, setTf] = useState(initialTf);
  const series = useMemo(() => resample(m1, tf), [m1, tf]);
  const boxes = useMemo(() => {
    const out: (Box & { trade: Trade })[] = [];
    for (const t of trades) {
      const b = boxFor(t, series);
      if (b) out.push({ ...b, trade: t });
    }
    return out;
  }, [trades, series]);

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const view = useRef({ from: Math.max(series.n - 160, 0), to: series.n + 8 });
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const hover = useRef<string | null>(null);
  const raf = useRef(0);
  const live = useRef({ series, boxes, selectedId, symbol });
  live.current = { series, boxes, selectedId, symbol };
  const size = useRef({ w: 800, h: 520 });
  const lastJump = useRef<number | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  const draw = () => {
    raf.current = 0;
    const c = cv.current;
    if (!c) return;
    const { w: W, h: H } = size.current;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const { series: s, boxes: bx, selectedId: sel } = live.current;
    const PW = W - AX, PH = H - AY;
    if (!s.n || PW < 50 || PH < 50) return;

    const v = view.current, span = v.to - v.from, barW = PW / span;
    const xOf = (i: number) => (i + 0.5 - v.from) * barW;
    const i0 = Math.max(0, Math.floor(v.from) - 1), i1 = Math.min(s.n - 1, Math.ceil(v.to) + 1);

    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { if (s.l[i] < lo) lo = s.l[i]; if (s.h[i] > hi) hi = s.h[i]; }
    if (!(hi > lo)) { const m = s.c[Math.min(Math.max(i0, 0), s.n - 1)] || 1; lo = m - 1; hi = m + 1; }
    const pad = (hi - lo) * 0.08;
    const pmin = lo - pad, pmax = hi + pad;
    const yOf = (p: number) => PH - ((p - pmin) / (pmax - pmin)) * PH;
    const pOf = (y: number) => pmin + ((PH - y) / PH) * (pmax - pmin);

    ctx.font = "11px system-ui, sans-serif";
    // price grid
    ctx.textBaseline = "middle";
    const ticks = niceTicks(pmin, pmax, Math.max(Math.round(PH / 55), 3));
    const dec = (pmax - pmin) < 2 ? 4 : (pmax - pmin) < 50 ? 2 : (pmax - pmin) < 500 ? 1 : 0;
    ctx.lineWidth = 1;
    for (const p of ticks) { const y = Math.round(yOf(p)) + 0.5; ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke(); }
    // time grid + labels (labels sit on the first candle of each aligned bucket)
    const wantMin = (110 / barW) * s.tf;
    const step = STEPS.find((x) => x >= wantMin) ?? STEPS[STEPS.length - 1];
    const stepMs = step * 60_000;
    const tl: { x: number; label: string; major: boolean }[] = [];
    for (let i = Math.max(i0, 0); i <= i1; i++) {
      const prevB = i > 0 ? Math.floor(s.t[i - 1] / stepMs) : -1;
      if (Math.floor(s.t[i] / stepMs) === prevB) continue;
      const newDay = i === 0 || new Date(s.t[i]).getUTCDate() !== new Date(s.t[i - 1]).getUTCDate();
      const dayLevel = step >= 1440;
      tl.push({ x: xOf(i), label: dayLevel || newDay ? dmy(s.t[i]) : clock(s.t[i]), major: newDay });
    }
    for (const t of tl) { ctx.strokeStyle = t.major ? "rgba(255,255,255,.1)" : GRID; ctx.beginPath(); ctx.moveTo(Math.round(t.x) + 0.5, 0); ctx.lineTo(Math.round(t.x) + 0.5, PH); ctx.stroke(); }

    // candles
    const bodyW = Math.max(Math.min(barW * 0.72, 22), 1);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, PW, PH); ctx.clip();
    for (let i = i0; i <= i1; i++) {
      const up = s.c[i] >= s.o[i];
      ctx.strokeStyle = ctx.fillStyle = up ? UP : DOWN;
      const x = Math.round(xOf(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, yOf(s.h[i])); ctx.lineTo(x, yOf(s.l[i])); ctx.lineWidth = 1; ctx.stroke();
      if (bodyW > 1.6) {
        const yo = yOf(s.o[i]), yc = yOf(s.c[i]);
        ctx.fillRect(x - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(Math.abs(yo - yc), 1));
      }
    }

    // long / short position boxes
    const labels: { x: number; y: number; txt: string; win: boolean; prio: number }[] = [];
    for (const b of bx) {
      if (b.i1 < v.from - 2 || b.i0 > v.to + 2) continue;
      const isSel = b.tradeId === sel, isHov = b.tradeId === hover.current;
      const dim = sel && !isSel ? 0.55 : 1;
      const x0 = xOf(b.i0), x1 = Math.max(xOf(b.i1), x0 + Math.max(barW, 5));
      const yE = yOf(b.entry);
      const zone = (price: number | null, rgb: string, edge: string) => {
        if (price === null) return;
        const y = yOf(price);
        ctx.fillStyle = `rgba(${rgb},${(isSel ? 0.3 : isHov ? 0.24 : 0.15) * dim})`;
        ctx.fillRect(x0, Math.min(yE, y), x1 - x0, Math.abs(y - yE));
        ctx.strokeStyle = edge; ctx.globalAlpha = dim; ctx.lineWidth = isSel ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.globalAlpha = 1;
      };
      zone(b.tp, "45,212,168", UP);
      zone(b.sl, "255,107,107", DOWN);
      ctx.globalAlpha = dim;
      ctx.strokeStyle = "#cfd6e0"; ctx.lineWidth = isSel ? 1.8 : 1.2;
      ctx.beginPath(); ctx.moveTo(x0, yE); ctx.lineTo(x1, yE); ctx.stroke();
      if (isSel || isHov) { ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1; ctx.strokeRect(x0, Math.min(yE, b.tp !== null ? yOf(b.tp) : yE, b.sl !== null ? yOf(b.sl) : yE), x1 - x0, Math.abs(Math.max(yE, b.tp !== null ? yOf(b.tp) : yE, b.sl !== null ? yOf(b.sl) : yE) - Math.min(yE, b.tp !== null ? yOf(b.tp) : yE, b.sl !== null ? yOf(b.sl) : yE))); }
      // path from entry to exit
      const yX = yOf(b.exit);
      ctx.strokeStyle = b.win ? UP : DOWN; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x0, yE); ctx.lineTo(x1, yX); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#cfd6e0"; ctx.beginPath(); ctx.arc(x0, yE, 3, 0, 7); ctx.fill();
      ctx.fillStyle = b.win ? UP : DOWN; ctx.strokeStyle = BG; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x1, yX, 4.2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      // label (drawn after all boxes, skipping any that would sit on top of another)
      if (x1 - x0 > 64 || isSel || isHov) {
        const t = b.trade;
        const rr = b.tp !== null && b.sl !== null ? ` · RR 1:${(Math.abs(b.tp - b.entry) / Math.abs(b.entry - b.sl)).toFixed(1)}` : "";
        const txt = `${b.dir > 0 ? "Long" : "Short"} ${t.volume} · ${t.net >= 0 ? "+" : "−"}${Math.abs(t.net).toFixed(2)}${t.rMultiple !== null ? ` · ${t.rMultiple.toFixed(2)}R` : ""}${rr}`;
        const topY = Math.min(yE, b.tp !== null ? yOf(b.tp) : yE, b.sl !== null ? yOf(b.sl) : yE);
        labels.push({ x: Math.max(x0, 2), y: Math.min(Math.max(topY - 20, 44), PH - 20), txt, win: b.win, prio: isSel ? 2 : isHov ? 1 : 0 });
      }
    }
    ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    labels.sort((p, q) => q.prio - p.prio);
    const taken: { x: number; y: number; w: number }[] = [];
    for (const L of labels) {
      const w = ctx.measureText(L.txt).width + 10;
      if (L.prio === 0 && taken.some((o) => L.x < o.x + o.w + 4 && L.x + w + 4 > o.x && Math.abs(L.y - o.y) < 19)) continue;
      taken.push({ x: L.x, y: L.y, w });
      ctx.fillStyle = L.win ? "rgba(26,120,98,.94)" : "rgba(150,52,52,.94)";
      ctx.fillRect(L.x, L.y, w, 17);
      ctx.fillStyle = "#fff"; ctx.fillText(L.txt, L.x + 5, L.y + 9);
    }
    ctx.restore();

    // axes
    ctx.fillStyle = BG; ctx.fillRect(PW, 0, AX, H); ctx.fillRect(0, PH, W, AY);
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.moveTo(PW + 0.5, 0); ctx.lineTo(PW + 0.5, PH); ctx.moveTo(0, PH + 0.5); ctx.lineTo(PW, PH + 0.5); ctx.stroke();
    ctx.fillStyle = TEXT; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    for (const p of ticks) ctx.fillText(p.toFixed(dec), PW + 8, yOf(p));
    ctx.textAlign = "center";
    for (const t of tl) if (t.x > 14 && t.x < PW - 14) { ctx.fillStyle = t.major ? "#e6e9ee" : TEXT; ctx.fillText(t.label, t.x, PH + AY / 2 + 1); }
    ctx.textAlign = "left";

    // crosshair + legend
    const m = mouse.current;
    let hi2 = Math.min(Math.max(Math.floor(v.from + (m ? m.x / barW : PW / barW)), 0), s.n - 1);
    if (!m) hi2 = Math.min(Math.max(Math.round(v.to) - 9, 0), s.n - 1);
    if (m && m.x >= 0 && m.x <= PW && m.y >= 0 && m.y <= PH) {
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      const cx = Math.round(xOf(hi2)) + 0.5;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, PH); ctx.moveTo(0, m.y + 0.5); ctx.lineTo(PW, m.y + 0.5); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#2a3040"; ctx.fillRect(PW, m.y - 9, AX, 18);
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(pOf(m.y).toFixed(dec), PW + 8, m.y);
      const lab = full(s.t[hi2]), lw = ctx.measureText(lab).width + 14;
      ctx.fillStyle = "#2a3040"; ctx.fillRect(Math.min(Math.max(cx - lw / 2, 0), PW - lw), PH + 3, lw, 19);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(lab, Math.min(Math.max(cx, lw / 2), PW - lw / 2), PH + AY / 2 + 1); ctx.textAlign = "left";
    }
    const up = s.c[hi2] >= s.o[hi2];
    const chg = s.o[hi2] ? ((s.c[hi2] - s.o[hi2]) / s.o[hi2]) * 100 : 0;
    const tfLabel = TF_CHOICES.find((x) => x.tf === s.tf)?.label ?? `${s.tf}m`;
    ctx.font = "12px system-ui, sans-serif"; ctx.textBaseline = "top"; ctx.fillStyle = "#e6e9ee";
    const head = `${live.current.symbol} · ${tfLabel}   `;
    ctx.fillText(head, 10, 8);
    let lx = 10 + ctx.measureText(head).width;
    ctx.fillStyle = up ? UP : DOWN;
    const ohlc = `O ${s.o[hi2].toFixed(dec)}  H ${s.h[hi2].toFixed(dec)}  L ${s.l[hi2].toFixed(dec)}  C ${s.c[hi2].toFixed(dec)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
    ctx.fillText(ohlc, lx, 8);
    ctx.fillStyle = TEXT; ctx.fillText(full(s.t[hi2]), 10, 26);
  };
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(draw); };
  useEffect(schedule); // redraw whenever props change

  // size
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); size.current = { w: Math.max(r.width, 100), h: Math.max(r.height, 100) }; schedule(); });
    ro.observe(el);
    const r = el.getBoundingClientRect(); size.current = { w: Math.max(r.width, 100), h: Math.max(r.height, 100) };
    schedule();
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, []);

  // jump to a trade (switch to a timeframe that frames it, then centre on it)
  useEffect(() => {
    if (!jump || lastJump.current === jump.n) return;
    const t = trades.find((x) => (x.dbId ?? x.externalId) === jump.id);
    if (!t) return;
    lastJump.current = jump.n;
    const want = tfForTrade(t);
    const target = TF_CHOICES.map((x) => x.tf).includes(want as never) ? want : 15;
    const sr = resample(m1, target);
    const b = boxFor(t, sr);
    if (b) view.current = clampView(viewForBox(b), sr.n);
    setTf(target);
    schedule();
  }, [jump, trades, m1]); // eslint-disable-line react-hooks/exhaustive-deps

  // switching timeframe keeps the same moment in view
  const changeTf = (next: number) => {
    if (next === tf) return;
    const s = live.current.series, v = view.current;
    const mid = Math.min(Math.max(Math.round((v.from + v.to) / 2), 0), s.n - 1);
    const midT = s.t[mid];
    const spanMin = (v.to - v.from) * s.tf;
    const ns = resample(m1, next);
    let lo = 0, hi = ns.n;
    while (lo < hi) { const k = (lo + hi) >> 1; if (ns.t[k] <= midT) lo = k + 1; else hi = k; }
    const c = Math.max(lo - 1, 0), span = Math.max(spanMin / next, 30);
    view.current = clampView({ from: c - span / 2, to: c + span / 2 }, ns.n);
    setTf(next);
  };

  // input
  const drag = useRef<{ x: number; from: number; to: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; from: number; to: number } | null>(null);

  const rel = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const zoomAt = (px: number, factor: number) => {
    const { w } = size.current, PW = w - AX, v = view.current, s = live.current.series;
    const span = v.to - v.from, idx = v.from + (px / PW) * span;
    const ns = Math.min(Math.max(span * factor, 12), Math.max(s.n * 1.6, 12));
    view.current = clampView({ from: idx - (px / PW) * ns, to: idx + (1 - px / PW) * ns }, s.n);
    schedule();
  };
  const hit = (x: number, y: number): string | null => {
    const { w, h } = size.current, PW = w - AX, PH = h - AY;
    const v = view.current, barW = PW / (v.to - v.from), s = live.current.series;
    const i0 = Math.max(0, Math.floor(v.from) - 1), i1 = Math.min(s.n - 1, Math.ceil(v.to) + 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { if (s.l[i] < lo) lo = s.l[i]; if (s.h[i] > hi) hi = s.h[i]; }
    const pad = (hi - lo) * 0.08, pmin = lo - pad, pmax = hi + pad;
    const yOf = (p: number) => PH - ((p - pmin) / (pmax - pmin)) * PH;
    const xOf = (i: number) => (i + 0.5 - v.from) * barW;
    const list = live.current.boxes;
    for (let k = list.length - 1; k >= 0; k--) {
      const b = list[k];
      const x0 = xOf(b.i0), x1 = Math.max(xOf(b.i1), x0 + Math.max(barW, 5));
      const ys = [yOf(b.entry), b.tp !== null ? yOf(b.tp) : yOf(b.entry), b.sl !== null ? yOf(b.sl) : yOf(b.entry), yOf(b.exit)];
      if (x >= x0 - 3 && x <= x1 + 5 && y >= Math.min(...ys) - 3 && y <= Math.max(...ys) + 3) return b.tradeId;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent) => {
    cv.current!.setPointerCapture(e.pointerId);
    const p = rel(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), ...view.current };
      drag.current = null;
    } else drag.current = { x: p.x, from: view.current.from, to: view.current.to, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = rel(e);
    mouse.current = p;
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, pinch.current.d / Math.max(d, 1) * ((view.current.to - view.current.from) / (pinch.current.to - pinch.current.from)));
      pinch.current.d = d; pinch.current.from = view.current.from; pinch.current.to = view.current.to;
      return;
    }
    const d = drag.current;
    if (d) {
      const dx = p.x - d.x;
      if (Math.abs(dx) > 3) d.moved = true;
      const PW = size.current.w - AX, shift = (dx / PW) * (d.to - d.from);
      view.current = clampView({ from: d.from - shift, to: d.to - shift }, live.current.series.n);
      setCursor("grabbing");
    } else {
      const h = hit(p.x, p.y);
      if (h !== hover.current) { hover.current = h; setCursor(h ? "pointer" : "crosshair"); }
    }
    schedule();
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    setCursor(hover.current ? "pointer" : "crosshair");
    if (d && !d.moved) { const p = rel(e); onSelect(hit(p.x, p.y)); }
  };
  const onLeave = () => { mouse.current = null; if (hover.current) { hover.current = null; } schedule(); };
  useEffect(() => {
    const el = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const PW = size.current.w - AX, v = view.current, sh = ((e.deltaX || e.deltaY) / PW) * (v.to - v.from);
        view.current = clampView({ from: v.from + sh, to: v.to + sh }, live.current.series.n); schedule();
      } else zoomAt(e.clientX - r.left, Math.exp(e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    const v = view.current, span = v.to - v.from, n = live.current.series.n;
    if (e.key === "ArrowLeft") view.current = clampView({ from: v.from - span * 0.1, to: v.to - span * 0.1 }, n);
    else if (e.key === "ArrowRight") view.current = clampView({ from: v.from + span * 0.1, to: v.to + span * 0.1 }, n);
    else if (e.key === "+" || e.key === "=") zoomAt((size.current.w - AX) / 2, 0.8);
    else if (e.key === "-") zoomAt((size.current.w - AX) / 2, 1.25);
    else return;
    e.preventDefault(); schedule();
  };
  const onDouble = () => {
    const s = live.current.series, id = live.current.selectedId;
    const b = live.current.boxes.find((x) => x.tradeId === id);
    view.current = clampView(b ? viewForBox(b) : { from: s.n - 160, to: s.n + 8 }, s.n);
    schedule();
  };

  return (
    <div className="lc">
      <div className="lc-bar">
        <div className="seg" role="group" aria-label="Timeframe">
          {TF_CHOICES.map((x) => <button key={x.tf} type="button" className={tf === x.tf ? "on" : ""} onClick={() => changeTf(x.tf)}>{x.label}</button>)}
        </div>
        <span className="muted small">Drag to pan · scroll to zoom · double-click to re-centre</span>
      </div>
      <div className="lc-canvas" ref={wrap}>
        <canvas ref={cv} tabIndex={0} style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} onDoubleClick={onDouble} onKeyDown={onKey} aria-label={`${symbol} chart with your trades`} />
      </div>
    </div>
  );
}
