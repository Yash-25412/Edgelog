"use client";

import { groupSetups, type Setup } from "@/lib/setups";

/** Toggle chips, grouped by category. A trade can carry several setups. */
export function SetupPicker({ setups, value, onChange }: { setups: Setup[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!setups.length) return <p className="muted small">No setups in your list yet. Use “Manage setups” to add some.</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const chosen = setups.filter((s) => value.includes(s.id) && s.note);
  return (
    <div className="sp">
      {groupSetups(setups).map((g) => (
        <div key={g.category} className="sp-group">
          <span className="sp-cat">{g.category}</span>
          <div className="chips">
            {g.items.map((s) => (
              <button type="button" key={s.id} className={"chip sp-chip" + (value.includes(s.id) ? " on" : "")} title={s.note ?? ""} aria-pressed={value.includes(s.id)} onClick={() => toggle(s.id)}>
                {value.includes(s.id) ? "✓ " : ""}{s.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      {chosen.length > 0 && (
        <ul className="sp-rules">
          {chosen.map((s) => <li key={s.id}><b>{s.name}:</b> <span className="muted">{s.note}</span></li>)}
        </ul>
      )}
    </div>
  );
}
