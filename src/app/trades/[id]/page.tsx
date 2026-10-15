"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { rowToTrade } from "@/lib/db";
import { rowToChart } from "@/lib/charts";
import { TradeChart } from "@/components/TradeChart";
import type { ChartWindow } from "@/lib/engine/chartwindow";
import { BUCKET, EMOTIONS, MISTAKES, rowToJournal } from "@/lib/journal";
import type { Trade } from "@/lib/types";
import { duration, money, num2, shortStamp } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

const cls = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "pos" : "neg");
const EXIT_NAME: Record<string, string> = { sl: "Stop loss", tp: "Take profit", stop_out: "Stop-out", manual: "Manual close" };
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

interface Form {
  setup: string;
  tagsText: string;
  mistakes: string[];
  emotion: number | null;
  notes: string;
  screenshots: string[];
}

const splitTags = (s: string) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];

export default function TradePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [trade, setTrade] = useState<Trade | null>(null);
  const [userId, setUserId] = useState("");
  const [form, setForm] = useState<Form>({ setup: "", tagsText: "", mistakes: [], emotion: null, notes: "", screenshots: [] });
  const [journalMissing, setJournalMissing] = useState(false);
  const [suggestions, setSuggestions] = useState<{ setups: string[]; tags: string[] }>({ setups: [], tags: [] });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const dirty = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [chart, setChart] = useState<ChartWindow | null>(null);
  const [savingChart, setSavingChart] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = getSupabase();
      const { data: s } = await sb.auth.getSession();
      if (!s.session) {
        router.replace("/login");
        return;
      }
      setUserId(s.session.user.id);
      const { data: row, error } = await sb.from("trades").select("*").eq("id", id).maybeSingle();
      if (error || !row) {
        setMessage({ kind: "bad", text: error?.message ?? "Trade not found." });
        setLoading(false);
        return;
      }
      setTrade(rowToTrade(row));

      const { data: ch } = await sb.from("trade_charts").select("*").eq("trade_id", id).maybeSingle();
      if (ch) setChart(rowToChart(ch)); // no chart yet, or the table is not created: the page works without it

      const { data: j, error: jErr } = await sb.from("trade_journal").select("*").eq("trade_id", id).maybeSingle();
      if (jErr) {
        setJournalMissing(true);
      } else {
        if (j) {
          const jr = rowToJournal(j);
          setForm({
            setup: jr.setup ?? "",
            tagsText: jr.tags.join(", "),
            mistakes: jr.mistakes,
            emotion: jr.emotion,
            notes: jr.notes ?? "",
            screenshots: jr.screenshots,
          });
        }
        const { data: all } = await sb.from("trade_journal").select("setup, tags").limit(1000);
        setSuggestions({
          setups: [...new Set((all ?? []).map((r: any) => r.setup).filter(Boolean))] as string[],
          tags: [...new Set((all ?? []).flatMap((r: any) => r.tags ?? []))] as string[],
        });
      }
      setLoading(false);
    })();
  }, [id, router]);

  useEffect(() => {
    if (!form.screenshots.length) {
      setUrls({});
      return;
    }
    getSupabase()
      .storage.from(BUCKET)
      .createSignedUrls(form.screenshots, 3600)
      .then(({ data }) => {
        const m: Record<string, string> = {};
        (data ?? []).forEach((d: any) => {
          if (d.path && d.signedUrl) m[d.path] = d.signedUrl;
        });
        setUrls(m);
      });
  }, [form.screenshots]);

  const save = useCallback(
    async (override?: Partial<Form>) => {
      const f = { ...form, ...override };
      setSaving(true);
      setMessage(null);
      const { error } = await getSupabase()
        .from("trade_journal")
        .upsert(
          {
            trade_id: id,
            user_id: userId,
            setup: f.setup.trim() || null,
            tags: splitTags(f.tagsText),
            mistakes: f.mistakes,
            emotion: f.emotion,
            notes: f.notes.trim() || null,
            screenshots: f.screenshots,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "trade_id" },
        );
      setSaving(false);
      if (error) setMessage({ kind: "bad", text: `Could not save: ${error.message}` });
      else {
        dirty.current = false;
        setMessage({ kind: "ok", text: "Saved." });
      }
    },
    [form, id, userId],
  );

  const update = (patch: Partial<Form>) => {
    dirty.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  const addImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length || !userId) return;
      setUploading(true);
      setMessage(null);
      const sb = getSupabase();
      const added: string[] = [];
      for (const file of images) {
        if (file.size > MAX_IMAGE_BYTES) {
          setMessage({ kind: "bad", text: `${file.name || "Image"} is over 6 MB.` });
          continue;
        }
        const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
        const path = `${userId}/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
        if (error) setMessage({ kind: "bad", text: `Upload failed: ${error.message}` });
        else added.push(path);
      }
      setUploading(false);
      if (added.length) {
        const next = [...form.screenshots, ...added];
        setForm((f) => ({ ...f, screenshots: next }));
        await save({ screenshots: next });
      }
    },
    [form.screenshots, id, save, userId],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        addImages(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImages]);

  async function removeImage(path: string) {
    const next = form.screenshots.filter((p) => p !== path);
    setForm((f) => ({ ...f, screenshots: next }));
    await getSupabase().storage.from(BUCKET).remove([path]);
    await save({ screenshots: next });
  }

  async function saveChartToJournal() {
    const svg = svgRef.current;
    if (!svg || !userId) return;
    setSavingChart(true);
    setMessage(null);
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.removeAttribute("style");
      clone.setAttribute("width", "1000");
      clone.setAttribute("height", "540");
      const xml = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not turn the chart into an image."));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not turn the chart into an image.");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not turn the chart into an image.");
      const path = `${userId}/${id}/chart.png`;
      const { error } = await getSupabase().storage.from(BUCKET).upload(path, blob, { contentType: "image/png", upsert: true });
      if (error) throw new Error(error.message);
      const next = form.screenshots.includes(path) ? form.screenshots : [path, ...form.screenshots];
      setForm((f) => ({ ...f, screenshots: next }));
      await save({ screenshots: next });
      setMessage({ kind: "ok", text: "Chart saved to this trade's screenshots." });
    } catch (e) {
      setMessage({ kind: "bad", text: e instanceof Error ? e.message : "Could not save the chart." });
    } finally {
      setSavingChart(false);
    }
  }

  if (loading) return <main className="center muted">Loading…</main>;
  if (!trade) {
    return (
      <main className="center">
        <div className="card">
          <div className="notice bad">{message?.text ?? "Trade not found."}</div>
          <p><Link href="/dashboard">← Back to dashboard</Link></p>
        </div>
      </main>
    );
  }

  const hold = Math.round((Date.parse(trade.closeTime + "Z") - Date.parse(trade.openTime + "Z")) / 1000);

  return (
    <div className="shell narrow">
      <header className="top">
        <Link href="/dashboard" className="back">← Back to trades</Link>
        <div className="brand">Edge<span>Log</span></div>
      </header>

      <section className="card">
        <h2>
          {trade.symbol} {trade.side === "buy" ? "Long" : "Short"} · {trade.volume} lots ·{" "}
          <span className={cls(trade.net)}>{money(trade.net, true)}</span>
        </h2>
        <div className="facts">
          <div><span>Opened</span><b>{shortStamp(trade.openTime)} @ {trade.openPrice}</b></div>
          <div><span>Closed</span><b>{shortStamp(trade.closeTime)} @ {trade.closePrice}</b></div>
          <div><span>Held</span><b>{duration(hold)}</b></div>
          <div><span>Exit</span><b>{EXIT_NAME[trade.exitReason ?? "manual"]}</b></div>
          <div><span>Stop at entry</span><b>{trade.initialSl ?? "none"}</b></div>
          <div><span>Target at entry</span><b>{trade.initialTp ?? "none"}</b></div>
          <div><span>Risk</span><b>{trade.riskMoney === null ? "unknown" : money(trade.riskMoney)}</b></div>
          <div><span>Result in R</span><b className={cls(trade.rMultiple)}>{trade.rMultiple === null ? "–" : num2(trade.rMultiple) + "R"}</b></div>
          <div><span>Profit</span><b>{money(trade.profit, true)}</b></div>
          <div><span>Commission + swap</span><b>{money(trade.commission + trade.swap, true)}</b></div>
        </div>
        {trade.exits.length > 1 && (
          <p className="muted small">
            Closed in {trade.exits.length} parts:{" "}
            {trade.exits.map((e) => `${e.volume} lots @ ${e.price} (${shortStamp(e.time)})`).join(" · ")}
          </p>
        )}
      </section>

      <section className="card">
        <div className="chart-head">
          <h2>Chart</h2>
          {chart && !journalMissing && (
            <button type="button" onClick={saveChartToJournal} disabled={savingChart}>
              {savingChart ? "Saving…" : "Save chart to journal screenshots"}
            </button>
          )}
        </div>
        {chart ? (
          <TradeChart trade={trade} chart={chart} svgRef={svgRef} />
        ) : (
          <p className="muted small">
            No candles for this trade yet. On the dashboard, open <b>Import trades</b> and add your MT5 one-minute bars file, or paste your own
            screenshot in the journal below.
          </p>
        )}
      </section>

      {journalMissing ? (
        <div className="notice">
          The journal isn&apos;t switched on yet. Run <b>0002_journal.sql</b> in the Supabase SQL Editor, then reload this page.
        </div>
      ) : (
        <form
          className="card journal"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h2>Journal</h2>

          <div className="row">
            <label>
              Setup
              <input list="setups" value={form.setup} onChange={(e) => update({ setup: e.target.value })} placeholder="e.g. Pullback to support" />
              <datalist id="setups">{suggestions.setups.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            <label>
              Tags (comma separated)
              <input value={form.tagsText} onChange={(e) => update({ tagsText: e.target.value })} placeholder="london open, news day" />
            </label>
          </div>
          {suggestions.tags.length > 0 && (
            <div className="chips">
              {suggestions.tags.slice(0, 12).map((t) => (
                <button
                  type="button"
                  key={t}
                  className="chip"
                  onClick={() => update({ tagsText: splitTags(form.tagsText + "," + t).join(", ") })}
                >
                  + {t}
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="label">Mistakes (leave empty if the trade followed your plan)</div>
            <div className="chips">
              {MISTAKES.map((m) => {
                const on = form.mistakes.includes(m);
                return (
                  <button
                    type="button"
                    key={m}
                    className={"chip" + (on ? " on" : "")}
                    aria-pressed={on}
                    onClick={() => update({ mistakes: on ? form.mistakes.filter((x) => x !== m) : [...form.mistakes, m] })}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="label">How did you feel going in?</div>
            <div className="chips">
              {EMOTIONS.map((label, i) => {
                const on = form.emotion === i + 1;
                return (
                  <button
                    type="button"
                    key={label}
                    className={"chip" + (on ? " on" : "")}
                    aria-pressed={on}
                    onClick={() => update({ emotion: on ? null : i + 1 })}
                  >
                    {i + 1} · {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label>
            Notes
            <textarea rows={5} value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Why did you take it? What did you see? What would you do differently?" />
          </label>

          <div>
            <div className="label">Screenshots</div>
            <div
              className="drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addImages([...e.dataTransfer.files]);
              }}
            >
              {uploading ? "Uploading…" : "Paste a screenshot (Ctrl+V), drop images here, or "}
              {!uploading && (
                <label className="filebtn">
                  choose files
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => { addImages([...(e.target.files ?? [])]); e.target.value = ""; }} />
                </label>
              )}
            </div>
            {form.screenshots.length > 0 && (
              <div className="shots">
                {form.screenshots.map((p) => (
                  <figure key={p}>
                    {urls[p] ? (
                      <a href={urls[p]} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urls[p]} alt="Trade screenshot" />
                      </a>
                    ) : (
                      <div className="shot-wait muted small">Loading…</div>
                    )}
                    <button type="button" className="link" onClick={() => removeImage(p)}>Remove</button>
                  </figure>
                ))}
              </div>
            )}
          </div>

          {message && <div className={message.kind === "bad" ? "notice bad" : "notice"}>{message.text}</div>}
          <button className="primary" disabled={saving || uploading}>{saving ? "Saving…" : "Save journal"}</button>
        </form>
      )}
    </div>
  );
}
