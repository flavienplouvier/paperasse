import { addScaled, normalizeRotation, screenAxes } from "./geometry";
import type { Annotation, Point, Rect } from "./types";

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
  /** Nom donné par l'utilisateur (« Pro », « Perso »…). */
  name?: string;
  /** Image PNG (signature, paraphe, mention dessinée, tampon importé). */
  dataUrl?: string;
  /** Texte (mention écrite, nom de l'identité). */
  text?: string;
  /** Identité : police choisie (sinon celle du document où on la pose). */
  fontKey?: string;
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
export type ImagePart = { type: "image"; dataUrl: string; width: number; height: number };
export type PlacePart =
  | ImagePart
  | { type: "text"; text: string; fontKey: string; fontSize: number; color: string }
  /** Plusieurs images côte à côte (paraphes de plusieurs signataires), chacune dans son cadre. */
  | { type: "row"; parts: ImagePart[] };

export const sortForStack = <T extends { kind: SignKind }>(list: T[]) =>
  [...list].sort((a, b) => STACK_ORDER.indexOf(a.kind) - STACK_ORDER.indexOf(b.kind));

const GAP = 6;
const LINE = 1.25;

export const partHeight = (p: PlacePart): number =>
  p.type === "image" ? p.height : p.type === "row" ? Math.max(...p.parts.map((x) => x.height)) : p.fontSize * LINE * p.text.split("\n").length;

export const partWidth = (p: PlacePart): number =>
  p.type === "image" ? p.width : p.type === "row" ? p.parts.reduce((w, x) => w + x.width, 0) + GAP * (p.parts.length - 1) : 0;

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
  // Largeur du bloc : celle des images ; un texte seul réserve 120 pt (sa largeur réelle dépend de la police).
  const width = Math.max(...parts.map(partWidth), parts.some((p) => p.type === "text") ? 120 : 0);
  const total = parts.reduce((h, p) => h + partHeight(p), 0) + GAP * (parts.length - 1);
  let top = addScaled(addScaled(at, right, -width / 2), down, -total / 2);
  const sideways = normalizeRotation(rotation) % 180 !== 0;
  const out: Placed[] = [];
  const image = (img: ImagePart, left: Point, rowHeight: number) => {
    // Centrée verticalement dans sa rangée.
    const center = addScaled(addScaled(left, right, img.width / 2), down, rowHeight / 2);
    const [hw, hh] = sideways ? [img.height / 2, img.width / 2] : [img.width / 2, img.height / 2];
    out.push({ type: "image", dataUrl: img.dataUrl, rect: [center[0] - hw, center[1] - hh, center[0] + hw, center[1] + hh] });
  };
  for (const p of parts) {
    const h = partHeight(p);
    if (p.type === "image") image(p, top, h);
    else if (p.type === "row") {
      let left = top;
      for (const img of p.parts) {
        image(img, left, h);
        left = addScaled(left, right, img.width + GAP);
      }
    } else {
      out.push({ type: "text", origin: addScaled(top, down, p.fontSize), text: p.text, fontKey: p.fontKey, fontSize: p.fontSize, color: p.color, rotation });
    }
    top = addScaled(top, down, h + GAP);
  }
  return out;
}

// ------------------------------------------------------------------ paraphes sur toutes les pages

/** Rectangle à l'écran (points, origine en haut à gauche) : [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

const overlaps = (a: Box, b: Box, gap: number) => a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;
const inside = (b: Box, w: number, h: number) => b[0] >= 0 && b[1] >= 0 && b[2] <= w && b[3] <= h;

/**
 * Place un cadre sans recouvrir les éléments déjà posés : il est décalé de
 * côté (vers `prefer`, puis dans l'autre sens), sinon vers le haut, en restant
 * dans la page. Sans place libre, la position demandée est gardée.
 */
export function freeSpot(box: Box, obstacles: Box[], page: { width: number; height: number }, prefer: "left" | "right", gap = GAP): Box {
  const free = (b: Box) => inside(b, page.width, page.height) && !obstacles.some((o) => overlaps(b, o, gap));
  if (free(box)) return box;
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const slide = (dir: "left" | "right" | "up"): Box | null => {
    let b = box;
    for (let n = 0; n < 50; n++) {
      const hit = obstacles.filter((o) => overlaps(b, o, gap));
      if (!hit.length) return inside(b, page.width, page.height) ? b : null;
      if (dir === "left") {
        const x1 = Math.min(...hit.map((o) => o[0])) - gap;
        b = [x1 - w, b[1], x1, b[3]];
      } else if (dir === "right") {
        const x0 = Math.max(...hit.map((o) => o[2])) + gap;
        b = [x0, b[1], x0 + w, b[3]];
      } else {
        const y1 = Math.min(...hit.map((o) => o[1])) - gap;
        b = [b[0], y1 - h, b[2], y1];
      }
      if (!inside(b, page.width, page.height)) return null;
    }
    return null;
  };
  return slide(prefer) ?? slide(prefer === "left" ? "right" : "left") ?? slide("up") ?? box;
}

/** Position du centre d'un cadre, en fraction de la page (identique sur toutes les pages). */
export interface PagePosition {
  fx: number;
  fy: number;
}

/** Coin bas gauche ou bas droit, à 28 pt des bords. */
export function cornerPosition(side: "left" | "right", w: number, h: number, page: { width: number; height: number }, margin = 28): PagePosition {
  const cx = side === "right" ? page.width - margin - w / 2 : margin + w / 2;
  return { fx: cx / page.width, fy: (page.height - margin - h / 2) / page.height };
}

/** Cadre à l'écran pour une position, ramené dans la page. */
export function boxAt(pos: PagePosition, w: number, h: number, page: { width: number; height: number }): Box {
  const cx = Math.min(page.width - w / 2, Math.max(w / 2, pos.fx * page.width));
  const cy = Math.min(page.height - h / 2, Math.max(h / 2, pos.fy * page.height));
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

/** Cadres à l'écran (points, viewport à l'échelle 1) des éléments déjà posés sur une page. */
export function obstaclesOn(annotations: Annotation[], pageId: string, vp: { convertToViewportPoint: (x: number, y: number) => number[] }): Box[] {
  return annotations.flatMap((a) => {
    if (a.pageId !== pageId || !("rect" in a) || !a.rect) return [];
    const [x0, y0] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x1, y1] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
    return [[Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] as Box];
  });
}

