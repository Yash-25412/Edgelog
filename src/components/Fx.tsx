"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts from 0 to `value` with an ease-out curve whenever the value changes. */
export function CountUp({ value, format, ms = 1100 }: { value: number | null; format: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState<number | null>(value === null || reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (value === null) return setShown(null);
    if (reduced()) return setShown(value);
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / ms, 1);
      const e = 1 - Math.pow(1 - p, 4);
      const v = a + (value - a) * e;
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{shown === null ? "–" : format(shown)}</>;
}

/** Fades and lifts its children in, with a stagger set by `i`. */
export function Reveal({ i = 0, children, className = "" }: { i?: number; children: ReactNode; className?: string }) {
  return (
    <div className={"reveal " + className} style={{ animationDelay: `${i * 70}ms` }}>
      {children}
    </div>
  );
}

/** A donut that fills to `frac` (0..1) with a glow. */
export function Ring({ frac, label, sub }: { frac: number | null; label: string; sub: string }) {
  const r = 46, c = 2 * Math.PI * r;
  const f = frac ?? 0;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" aria-label={`${label} ${sub}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform="rotate(-90 60 60)"
          className="ring-arc" style={{ ["--c" as string]: c, filter: "drop-shadow(0 0 6px var(--accent))" }}
        />
        <text x="60" y="58" textAnchor="middle" fill="var(--text)" fontSize="22" fontWeight="700">{label}</text>
        <text x="60" y="76" textAnchor="middle" fill="var(--muted)" fontSize="10">{sub}</text>
      </svg>
    </div>
  );
}
