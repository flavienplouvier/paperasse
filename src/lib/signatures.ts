import { addScaled, normalizeRotation, screenAxes } from "./geometry";
import type { Point, Rect } from "./types";

/**
 * Signatures, paraphes, mentions, identités et tampons enregistrés sur
 * l'appareil (IndexedDB) pour être réutilisés. Rien ne quitte l'appareil, sauf
 * si l'utilisateur exporte lui-même un fichier de sauvegarde.
 */

export type SignKind = "signature" | "initials" | "mention" | "identity" | "stamp";

/** Ordre de pose, de haut en bas : mention, signature, paraphe, identité, tampon. */
export const SIGN_KINDS: SignKind[] = ["signature", "initials", "mention", "identity", "stamp"];
const STACK_ORDER: SignKind[] = ["mention", "signature", "initials", "identity", "stamp"];

export interface SignItem {
  id: string;
  kind: SignKind;
  createdAt: number;
  /** Image PNG (signature, paraphe, mention dessinée, tampon importé). */
  dataUrl?: string;
  /** Texte (mention écrite, nom de l'identité). */
  text?: string;
  /** Identité : ville de la ligne « Fait à …, le … ». */
  city?: string;
  /** Identité : ajoute la ligne « Fait à …, le {date} ». */
  withDate?: boolean;
  /** Tampon texte : libellé, couleur, date du jour. */
  stamp?: { label: string; color: string; withDate: boolean };
  color?: string;
}

// ------------------------------------------------------------------ stockage

const DB = "paperasse-signatures";
const STORE = "items";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function listSignItems(): Promise<SignItem[]> {
  const all = await run<SignItem[]>("readonly", (s) => s.getAll() as IDBRequest<SignItem[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export const saveSignItem = (item: SignItem) => run("readwrite", (s) => s.put(item));
export const deleteSignItem = (id: string) => run("readwrite", (s) => s.delete(id));
export const clearSignItems = () => run("readwrite", (s) => s.clear());

// ------------------------------------------------------------------ sauvegarde dans un fichier

const FORMAT = "paperasse-signatures";

export function exportSignItems(items: SignItem[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), items }, null, 1);
}

/** Lit un fichier de sauvegarde ; renvoie null si ce n'en est pas un. */
export function parseSignItems(text: string): SignItem[] | null {
  try {
    const data = JSON.parse(text);
    if (data?.format !== FORMAT || !Array.isArray(data.items)) return null;
    return (data.items as SignItem[]).filter(
      (i) => typeof i?.id === "string" && SIGN_KINDS.includes(i.kind) && (typeof i.dataUrl === "string" ? i.dataUrl.startsWith("data:image/") : true),
    );
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ pose sur la page

/** Élément prêt à poser : une image ou des lignes de texte. */
export type PlacePart =
  | { type: "image"; dataUrl: string; width: number; height: number }
  | { type: "text"; text: string; fontKey: string; fontSize: number; color: string };

export const sortForStack = <T extends { kind: SignKind }>(list: T[]) =>
  [...list].sort((a, b) => STACK_ORDER.indexOf(a.kind) - STACK_ORDER.indexOf(b.kind));

const GAP = 6;
const LINE = 1.25;

export const partHeight = (p: PlacePart) => (p.type === "image" ? p.height : p.fontSize * LINE * p.text.split("\n").length);

export type Placed =
  | { type: "image"; rect: Rect; dataUrl: string }
  | { type: "text"; origin: Point; text: string; fontKey: string; fontSize: number; color: string; rotation: number };

/**
 * Empile les éléments à l'écran, de haut en bas, alignés à gauche, le bloc
 * centré sur le point touché ; renvoie les positions en coordonnées PDF
 * (rotation de la page comprise).
 */
export function layoutParts(parts: PlacePart[], at: Point, rotation: number): Placed[] {
  const { right, down } = screenAxes(rotation);
  const width = Math.max(...parts.map((p) => (p.type === "image" ? p.width : 0)), 120);
  const total = parts.reduce((h, p) => h + partHeight(p), 0) + GAP * (parts.length - 1);
  let top = addScaled(addScaled(at, right, -width / 2), down, -total / 2);
  const sideways = normalizeRotation(rotation) % 180 !== 0;
  const out: Placed[] = [];
  for (const p of parts) {
    const h = partHeight(p);
    if (p.type === "image") {
      const center = addScaled(addScaled(top, right, p.width / 2), down, h / 2);
      const [hw, hh] = sideways ? [h / 2, p.width / 2] : [p.width / 2, h / 2];
      out.push({ type: "image", dataUrl: p.dataUrl, rect: [center[0] - hw, center[1] - hh, center[0] + hw, center[1] + hh] });
    } else {
      out.push({ type: "text", origin: addScaled(top, down, p.fontSize), text: p.text, fontKey: p.fontKey, fontSize: p.fontSize, color: p.color, rotation });
    }
    top = addScaled(top, down, h + GAP);
  }
  return out;
}
