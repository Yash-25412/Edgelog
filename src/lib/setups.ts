/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Setup {
  id: string;
  name: string;
  category: string;
  note: string | null;
}

/** Suggested groups. Free text in the database, so you can invent your own. */
export const CATEGORIES = ["Entry", "Structure", "Alignment"];

export const rowToSetup = (r: any): Setup => ({ id: r.id, name: r.name, category: r.category || "Entry", note: r.note ?? null });

/** Setups grouped by category, categories in a stable order (suggested ones first), names A to Z. */
export function groupSetups(list: Setup[]): { category: string; items: Setup[] }[] {
  const cats = [...new Set(list.map((s) => s.category))].sort((a, b) => {
    const ia = CATEGORIES.indexOf(a), ib = CATEGORIES.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return cats.map((category) => ({ category, items: list.filter((s) => s.category === category).sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Names for a trade's setup ids, skipping ids that no longer exist (a deleted setup). */
export const namesFor = (ids: string[], byId: Map<string, string>) => ids.map((i) => byId.get(i)).filter(Boolean) as string[];
