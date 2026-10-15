/**
 * Bibliothèque de formes. Chaque forme est un tracé SVG calculé pour une boîte
 * de largeur `w` et de hauteur `h` (origine en haut à gauche, y vers le bas),
 * utilisé à la fois pour l'aperçu à l'écran et pour l'écriture dans le PDF.
 */

export type ShapeId =
  | "line"
  | "arrow"
  | "doubleArrow"
  | "rect"
  | "roundRect"
  | "ellipse"
  | "triangle"
  | "rightTriangle"
  | "diamond"
  | "parallelogram"
  | "trapezoid"
  | "pentagon"
  | "hexagon"
  | "octagon"
  | "star"
  | "star4"
  | "heart"
  | "arrowRight"
  | "arrowLeft"
  | "arrowUp"
  | "arrowDown"
  | "bubble"
  | "plus"
  | "cross"
  | "check";

type P = [number, number];

const f = (n: number) => Math.round(n * 100) / 100;
const poly = (pts: P[]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L")} Z`;

/** Polygone régulier inscrit dans la boîte (pointe en haut). */
function regular(n: number, w: number, h: number, offset = -Math.PI / 2): string {
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i * 2 * Math.PI) / n;
    pts.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
  }
  return poly(pts);
}

function starPath(branches: number, inner: number, w: number, h: number): string {
  const pts: P[] = [];
  for (let i = 0; i < branches * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / branches;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]);
  }
  return poly(pts);
}

function ellipsePath(w: number, h: number): string {
  // Quatre courbes de Bézier (approximation standard du cercle).
  const k = 0.5523;
  const rx = w / 2;
  const ry = h / 2;
  return [
    `M${f(rx)} 0`,
    `C${f(rx + k * rx)} 0 ${f(w)} ${f(ry - k * ry)} ${f(w)} ${f(ry)}`,
    `C${f(w)} ${f(ry + k * ry)} ${f(rx + k * rx)} ${f(h)} ${f(rx)} ${f(h)}`,
    `C${f(rx - k * rx)} ${f(h)} 0 ${f(ry + k * ry)} 0 ${f(ry)}`,
    `C0 ${f(ry - k * ry)} ${f(rx - k * rx)} 0 ${f(rx)} 0 Z`,
  ].join(" ");
}

function roundRectPath(w: number, h: number): string {
  const r = Math.min(w, h) * 0.18;
  const k = 0.5523 * r;
  return [
    `M${f(r)} 0 H${f(w - r)}`,
    `C${f(w - r + k)} 0 ${f(w)} ${f(r - k)} ${f(w)} ${f(r)}`,
    `V${f(h - r)}`,
    `C${f(w)} ${f(h - r + k)} ${f(w - r + k)} ${f(h)} ${f(w - r)} ${f(h)}`,
    `H${f(r)}`,
    `C${f(r - k)} ${f(h)} 0 ${f(h - r + k)} 0 ${f(h - r)}`,
    `V${f(r)}`,
    `C0 ${f(r - k)} ${f(r - k)} 0 ${f(r)} 0 Z`,
  ].join(" ");
}

function heartPath(w: number, h: number): string {
  const X = (x: number) => f(x * w);
  const Y = (y: number) => f(y * h);
  return [
    `M${X(0.5)} ${Y(0.25)}`,
    `C${X(0.5)} ${Y(0.1)} ${X(0.35)} ${Y(0)} ${X(0.22)} ${Y(0)}`,
    `C${X(0.08)} ${Y(0)} ${X(0)} ${Y(0.12)} ${X(0)} ${Y(0.28)}`,
    `C${X(0)} ${Y(0.55)} ${X(0.3)} ${Y(0.72)} ${X(0.5)} ${Y(1)}`,
    `C${X(0.7)} ${Y(0.72)} ${X(1)} ${Y(0.55)} ${X(1)} ${Y(0.28)}`,
    `C${X(1)} ${Y(0.12)} ${X(0.92)} ${Y(0)} ${X(0.78)} ${Y(0)}`,
    `C${X(0.65)} ${Y(0)} ${X(0.5)} ${Y(0.1)} ${X(0.5)} ${Y(0.25)} Z`,
  ].join(" ");
}

/** Flèche pleine vers la droite, puis tournée selon la direction voulue. */
function blockArrow(dir: "right" | "left" | "up" | "down", w: number, h: number): string {
  const base: P[] = [
    [0, 0.3],
    [0.6, 0.3],
    [0.6, 0],
    [1, 0.5],
    [0.6, 1],
    [0.6, 0.7],
    [0, 0.7],
  ];
  const map = (x: number, y: number): P => {
    if (dir === "right") return [x * w, y * h];
    if (dir === "left") return [(1 - x) * w, y * h];
    if (dir === "down") return [y * w, x * h];
    return [y * w, (1 - x) * h];
  };
  return poly(base.map(([x, y]) => map(x, y)));
}

function crossPath(w: number, h: number, diagonal: boolean): string {
  if (!diagonal) {
    const t = 1 / 3;
    return poly(
      (
        [
          [t, 0], [1 - t, 0], [1 - t, t], [1, t], [1, 1 - t], [1 - t, 1 - t],
          [1 - t, 1], [t, 1], [t, 1 - t], [0, 1 - t], [0, t], [t, t],
        ] as P[]
      ).map(([x, y]) => [x * w, y * h]),
    );
  }
  const d = 0.18;
  return poly(
    (
      [
        [d, 0], [0.5, 0.5 - d], [1 - d, 0], [1, d], [0.5 + d, 0.5], [1, 1 - d],
        [1 - d, 1], [0.5, 0.5 + d], [d, 1], [0, 1 - d], [0.5 - d, 0.5], [0, d],
      ] as P[]
    ).map(([x, y]) => [x * w, y * h]),
  );
}

export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** Formes tracées d'un point à un autre (traits et flèches). */
  linear?: boolean;
  /** Tracé ouvert : jamais rempli (coche). */
  open?: boolean;
  path?: (w: number, h: number) => string;
}

export const SHAPES: ShapeDef[] = [
  { id: "line", label: "Trait", linear: true },
  { id: "arrow", label: "Flèche", linear: true },
  { id: "doubleArrow", label: "Double flèche", linear: true },
  { id: "rect", label: "Rectangle", path: (w, h) => `M0 0 H${f(w)} V${f(h)} H0 Z` },
  { id: "roundRect", label: "Rectangle arrondi", path: roundRectPath },
  { id: "ellipse", label: "Ellipse", path: ellipsePath },
  { id: "triangle", label: "Triangle", path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  { id: "rightTriangle", label: "Triangle rectangle", path: (w, h) => poly([[0, 0], [w, h], [0, h]]) },
  { id: "diamond", label: "Losange", path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) },
  { id: "parallelogram", label: "Parallélogramme", path: (w, h) => poly([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]) },
  { id: "trapezoid", label: "Trapèze", path: (w, h) => poly([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]]) },
  { id: "pentagon", label: "Pentagone", path: (w, h) => regular(5, w, h) },
  { id: "hexagon", label: "Hexagone", path: (w, h) => regular(6, w, h, 0) },
  { id: "octagon", label: "Octogone", path: (w, h) => regular(8, w, h, Math.PI / 8) },
  { id: "star", label: "Étoile", path: (w, h) => starPath(5, 0.42, w, h) },
  { id: "star4", label: "Étoile 4 branches", path: (w, h) => starPath(4, 0.32, w, h) },
  { id: "heart", label: "Cœur", path: heartPath },
  { id: "arrowRight", label: "Flèche pleine droite", path: (w, h) => blockArrow("right", w, h) },
  { id: "arrowLeft", label: "Flèche pleine gauche", path: (w, h) => blockArrow("left", w, h) },
  { id: "arrowUp", label: "Flèche pleine haut", path: (w, h) => blockArrow("up", w, h) },
  { id: "arrowDown", label: "Flèche pleine bas", path: (w, h) => blockArrow("down", w, h) },
  {
    id: "bubble",
    label: "Bulle",
    path: (w, h) => poly([[0, 0], [w, 0], [w, h * 0.72], [w * 0.42, h * 0.72], [w * 0.2, h], [w * 0.24, h * 0.72], [0, h * 0.72]]),
  },
  { id: "plus", label: "Plus", path: (w, h) => crossPath(w, h, false) },
  { id: "cross", label: "Croix", path: (w, h) => crossPath(w, h, true) },
  {
    id: "check",
    label: "Coche",
    open: true,
    path: (w, h) => `M${f(w * 0.08)} ${f(h * 0.55)} L${f(w * 0.38)} ${f(h * 0.86)} L${f(w * 0.92)} ${f(h * 0.14)}`,
  },
];

export const shapeDef = (id: ShapeId): ShapeDef => SHAPES.find((s) => s.id === id) ?? SHAPES[3];
