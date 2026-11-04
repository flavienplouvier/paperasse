/**
 * Couleurs prises à la pipette : les 7 dernières, la plus récente d'abord,
 * gardées sur cet appareil.
 */

export const PICKED_MAX = 7;
const STORE = "paperasse-pipette";
const HEX = /^#[0-9a-f]{6}$/i;

export function loadPickedColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, PICKED_MAX) : [];
  } catch {
    return [];
  }
}

export function addPickedColor(list: string[], hex: string): string[] {
  const c = hex.toLowerCase();
  const next = [c, ...list.filter((x) => x !== c)].slice(0, PICKED_MAX);
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    /* stockage indisponible : la liste vit le temps de la session */
  }
  return next;
}

/** « rgb(12, 34, 56) » ou « #AbC123 » → « #abc123 » (la pipette native renvoie l'un ou l'autre). */
export function toHex(color: string): string | null {
  const s = color.trim().toLowerCase();
  if (HEX.test(s)) return s;
  const m = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec(s);
  if (!m) return null;
  return `#${m.slice(1, 4).map((v) => Math.min(255, +v).toString(16).padStart(2, "0")).join("")}`;
}
