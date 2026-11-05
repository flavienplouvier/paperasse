import type { Annotation, Point, Rect } from "./types";
import { newId } from "./types";
import { translateRect } from "./geometry";

export function translateAnnotation<T extends Annotation>(a: T, dx: number, dy: number): T {
  const mv = (p: Point): Point => [p[0] + dx, p[1] + dy];
  switch (a.kind) {
    case "ink":
      return { ...a, points: a.points.map(mv) };
    case "line":
      return { ...a, from: mv(a.from), to: mv(a.to), ...(a.control ? { control: mv(a.control) } : {}) };
    case "text":
      return { ...a, origin: mv(a.origin), ...(a.pivot ? { pivot: mv(a.pivot) } : {}) };
    default:
      return { ...a, rect: translateRect(a.rect, dx, dy) };
  }
}

export function hasRect(a: Annotation): a is Extract<Annotation, { rect: Rect }> {
  return "rect" in a;
}

export function duplicateAnnotation(a: Annotation, offset = 12): Annotation {
  return { ...translateAnnotation(a, offset, -offset), id: newId("annot") };
}

/** Simplifie un tracé à main levée (Ramer–Douglas–Peucker) pour alléger le PDF. */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let index = 0;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (maxD > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ------------------------------------------------------------------ courbes, rotation, taille

/** Point de la courbe quadratique (from, control, to) au paramètre t. */
export function curveAt(from: Point, to: Point, control: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * from[0] + 2 * u * t * control[0] + t * t * to[0], u * u * from[1] + 2 * u * t * control[1] + t * t * to[1]];
}

/** La courbe découpée en segments (export PDF, gomme). */
export function curvePoints(from: Point, to: Point, control: Point, n = 32): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => curveAt(from, to, control, i / n));
}

/** Point de contrôle pour que la courbe passe par `through` en son milieu. */
export function bendControl(from: Point, to: Point, through: Point): Point {
  return [2 * through[0] - (from[0] + to[0]) / 2, 2 * through[1] - (from[1] + to[1]) / 2];
}

/** Tourne `p` autour de `c` de `deg` degrés (sens trigonométrique, repère PDF). */
export function rotateAround(p: Point, c: Point, deg: number): Point {
  const a = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)];
}

export const rectCenter = (r: Rect): Point => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

/**
 * Poignée de redimensionnement : côté du cadre déplacé en x (0 = gauche, 2 = droite)
 * et en y (1 = bas, 3 = haut), null = ce sens ne change pas (poignée de bord).
 */
export type ResizeHandle = [0 | 2 | null, 1 | 3 | null];

/** Les huit poignées classiques : quatre coins et le milieu des quatre bords. */
export const RESIZE_HANDLES: ResizeHandle[] = [
  [0, 3], [null, 3], [2, 3],
  [0, null], [2, null],
  [0, 1], [null, 1], [2, 1],
];

/** Déplace les côtés d'un cadre désignés par une poignée (repère non tourné). */
export function moveSides(rect: Rect, handle: ResizeHandle, p: Point): Rect {
  const r = [...rect] as Rect;
  if (handle[0] !== null) r[handle[0]] = p[0];
  if (handle[1] !== null) r[handle[1]] = p[1];
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/**
 * Redimensionne par un coin ou un bord un cadre tourné de `angle` (degrés, sens
 * horaire à l'écran) : le coin ou le bord opposé reste en place à l'écran.
 */
export function resizeRotated(rect: Rect, handle: ResizeHandle, pointer: Point, angle: number): Rect {
  const c = rectCenter(rect);
  // Le pointeur, ramené dans le repère non tourné du cadre.
  const local = rotateAround(pointer, c, angle);
  const next = moveSides(rect, handle, local);
  const anchor: Point = [handle[0] === null ? c[0] : rect[handle[0] === 0 ? 2 : 0], handle[1] === null ? c[1] : rect[handle[1] === 1 ? 3 : 1]];
  if (!angle) return next;
  // Le cadre tourne autour de son centre : on le recale pour que le coin opposé ne bouge pas.
  const before = rotateAround(anchor, c, -angle);
  const after = rotateAround(anchor, rectCenter(next), -angle);
  const dx = before[0] - after[0];
  const dy = before[1] - after[1];
  return [next[0] + dx, next[1] + dy, next[2] + dx, next[3] + dy];
}

/** Cadre englobant d'un tracé. */
export function pointsBox(points: Point[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Agrandit ou réduit un tracé pour qu'il occupe `to` au lieu de `from`. */
export function scalePoints(points: Point[], from: Rect, to: Rect): Point[] {
  // Tracé plat (trait horizontal ou vertical) : pas d'étirement dans ce sens.
  const sx = from[2] - from[0] < 0.5 ? 1 : (to[2] - to[0]) / (from[2] - from[0]);
  const sy = from[3] - from[1] < 0.5 ? 1 : (to[3] - to[1]) / (from[3] - from[1]);
  return points.map((p) => [to[0] + (p[0] - from[0]) * sx, to[1] + (p[1] - from[1]) * sy]);
}
