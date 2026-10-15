import type { Point, Rect } from "./types";

export function normalizeRect(a: Point, b: Point): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
}

/** Rotation normalisée dans {0, 90, 180, 270}. */
export function normalizeRotation(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

/**
 * Vecteurs (en espace PDF) correspondant à « vers la droite » et « vers le bas »
 * à l'écran pour une page tournée de `rotation` degrés dans le sens horaire.
 * Une rotation horaire à l'affichage équivaut à une rotation anti-horaire
 * du contenu dans l'espace PDF.
 */
export function screenAxes(rotation: number): { right: Point; down: Point } {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { right: [0, 1], down: [1, 0] };
    case 180:
      return { right: [-1, 0], down: [0, 1] };
    case 270:
      return { right: [0, -1], down: [-1, 0] };
    default:
      return { right: [1, 0], down: [0, -1] };
  }
}

export function addScaled(p: Point, v: Point, k: number): Point {
  return [p[0] + v[0] * k, p[1] + v[1] * k];
}

export function rectContains(r: Rect, p: Point, margin = 0): boolean {
  return p[0] >= r[0] - margin && p[0] <= r[2] + margin && p[1] >= r[1] - margin && p[1] <= r[3] + margin;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.hypot(x, y);
}

/** "#rrggbb" → composantes 0..1 */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
