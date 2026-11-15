"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { CATEGORIES, groupSetups, type Setup } from "@/lib/setups";

/** Add, edit and delete your setups. Calls onChange after every save so pickers refresh. */
export function SetupsManager({ setups, userId, onChange }: { setups: Setup[]; userId: string; onChange: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Entry");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", category: "Entry", note: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cats = [...new Set([...CATEGORIES, ...setups.map((s) => s.category)])];
  const clash = (n: string, except?: string) => setups.some((s) => s.id !== except && s.name.trim().toLowerCase() === n.trim().toLowerCase());

  async function add() {
    setMsg(null);
    if (!name.trim()) return setMsg("Give the setup a name.");
    if (clash(name)) return setMsg(`You already have a setup called "${name.trim()}".`);
    setBusy(true);
    const { error } = await getSupabase().from("setups").insert({ user_id: userId, name: name.trim(), category: category.trim() || "Entry", note: note.trim() || null });
    setBusy(false);
    if (error) return setMsg(/setups/.test(error.message) && /exist|find/.test(error.message) ? "The setups table does not exist yet. Run 0004_candles_setups.sql in Supabase." : error.message);
    setName(""); setNote("");
    onChange();
  }

  async function saveEdit(id: string) {
    setMsg(null);
    if (!draft.name.trim()) return setMsg("A setup needs a name.");
    if (clash(draft.name, id)) return setMsg(`You already have a setup called "${draft.name.trim()}".`);
    setBusy(true);
    const { error } = await getSupabase().from("setups").update({ name: draft.name.trim(), category: draft.category.trim() || "Entry", note: draft.note.trim() || null }).eq("id", id);
    setBusy(false);
    if (error) return setMsg(error.message);
    setEditing(null);
    onChange();
  }

  async function remove(s: Setup) {
    if (!window.confirm(`Delete the setup "${s.name}"? It is removed from every trade that uses it. The trades themselves are not touched.`)) return;
    setBusy(true);
    const sb = getSupabase();
    const { data: used } = await sb.from("trade_journal").select("trade_id, setup_ids").contains("setup_ids", [s.id]);
    for (const j of used ?? []) {
      await sb.from("trade_journal").update({ setup_ids: ((j as any).setup_ids as string[]).filter((x) => x !== s.id) }).eq("trade_id", (j as any).trade_id);
    }
    const { error } = await sb.from("setups").delete().eq("id", s.id);
    setBusy(false);
    if (error) return setMsg(error.message);
    onChange();
  }

  return (
    <div className="setups-mgr">
      <div className="sm-add">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Liquidity sweep entry" /></label>
        <label>Group
          <input list="setup-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="setup-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="sm-note">Rules (optional)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What must be true for this setup?" /></label>
        <button type="button" className="primary" disabled={busy} onClick={add}>Add setup</button>
      </div>
      {msg && <div className="notice bad">{msg}</div>}

      {setups.length === 0 ? (
        <p className="muted small">No setups yet. Add the first one above.</p>
      ) : (
        groupSetups(setups).map((g) => (
          <div key={g.category} className="sm-group">
            <h3>{g.category}</h3>
            {g.items.map((s) => (
              <div key={s.id} className="sm-row">
                {editing === s.id ? (
                  <div className="sm-edit">
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
                    <input list="setup-cats" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Group" />
                    <textarea rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} aria-label="Rules" />
                    <div className="sm-actions">
                      <button type="button" className="primary" disabled={busy} onClick={() => saveEdit(s.id)}>Save</button>
                      <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sm-main">
                      <b>{s.name}</b>
                      {s.note ? <p className="muted small">{s.note}</p> : <p className="muted small">No rules written yet.</p>}
                    </div>
                    <div className="sm-actions">
                      <button type="button" className="link" onClick={() => { setEditing(s.id); setDraft({ name: s.name, category: s.category, note: s.note ?? "" }); }}>Edit</button>
                      <button type="button" className="link danger" onClick={() => remove(s)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
