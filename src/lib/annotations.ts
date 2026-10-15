import type { Annotation, Point, Rect } from "./types";
import { newId } from "./types";
import { translateRect } from "./geometry";

export function translateAnnotation<T extends Annotation>(a: T, dx: number, dy: number): T {
  const mv = (p: Point): Point => [p[0] + dx, p[1] + dy];
  switch (a.kind) {
    case "ink":
      return { ...a, points: a.points.map(mv) };
    case "line":
      return { ...a, from: mv(a.from), to: mv(a.to) };
    case "text":
      return { ...a, origin: mv(a.origin) };
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
