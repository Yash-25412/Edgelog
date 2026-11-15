"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { rowToSetup, type Setup } from "@/lib/setups";
import { SetupsManager } from "@/components/SetupsManager";

export default function SetupsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [setups, setSetups] = useState<Setup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return router.replace("/login");
    setUserId(s.session.user.id);
    const { data, error: e } = await sb.from("setups").select("*").order("name", { ascending: true });
    if (e) setError("The setups list is not switched on yet. Run 0004_candles_setups.sql in the Supabase SQL Editor, then reload this page.");
    else setSetups((data ?? []).map(rowToSetup));
    setLoading(false);
  }, [router]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">Edge<span>Log</span></div>
        <div className="top-right"><Link href="/dashboard" className="linkbtn">← Dashboard</Link></div>
      </header>
      <section className="card">
        <h2>My setups</h2>
        <p className="muted small">Your own list. Pick from it when journaling a trade; a trade can have several (for example one entry setup, one structure setup and one higher-timeframe alignment). The rules you write here are for you, and later for the AI assistant.</p>
        {error && <div className="notice bad">{error}</div>}
        {loading ? <p className="muted">Loading…</p> : !error && <SetupsManager setups={setups} userId={userId} onChange={load} />}
      </section>
    </div>
  );
}
