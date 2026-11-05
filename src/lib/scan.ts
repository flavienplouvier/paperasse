import { msg } from "../i18n";

/**
 * Numérisation de documents à l'appareil photo : détection des bords de la
 * feuille, redressement de la perspective et nettoyage (ombres, fond blanc).
 * Fonctions pures sur des pixels RGBA, sans canvas, pour être testables.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Coins de la feuille : haut-gauche, haut-droite, bas-droite, bas-gauche. */
export type Quad = [Point, Point, Point, Point];

export type ScanFilter = "auto" | "gray" | "bw" | "original";

export const SCAN_FILTERS: { id: ScanFilter; label: string }[] = [
  { id: "auto", label: msg("Éclairci") },
  { id: "gray", label: msg("Gris") },
  { id: "bw", label: msg("Noir et blanc") },
  { id: "original", label: msg("Original") },
];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ outils

/** Réduction par moyenne pour que le plus grand côté fasse au plus `max` pixels. */
export function downscale(img: Pixels, max: number): Pixels {
  const f = Math.max(img.width, img.height) / max;
  if (f <= 1) return img;
  const width = Math.max(1, Math.round(img.width / f));
  const height = Math.max(1, Math.round(img.height / f));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * f);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * f)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * f);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * f)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Flou en boîte séparable (rayon r) sur une image à un canal. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++, n++) s += src[y * w + k];
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++, n++) s += tmp[k * w + x];
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Seuil d'Otsu d'un histogramme de 256 classes. */
function otsu(hist: Uint32Array | number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Enveloppe convexe (chaîne monotone d'Andrew). */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Remet quatre points dans l'ordre haut-gauche, haut-droite, bas-droite, bas-gauche. */
export function orderQuad(pts: Point[]): Quad {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // Tri par angle (sens horaire à l'écran, y vers le bas) ; on commence par le coin le plus en haut à gauche.
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]) as Quad;
}

/** Quadrilatère d'aire maximale inscrit dans l'enveloppe (optimisation locale coin par coin). */
function bestQuad(hull: Point[]): Quad | null {
  const n = hull.length;
  if (n < 4) return null;
  // Départ : points extrêmes selon les diagonales.
  const pick = (f: (p: Point) => number) => hull.reduce((bi, p, i) => (f(p) > f(hull[bi]) ? i : bi), 0);
  let idx = [pick((p) => -p.x - p.y), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => -p.x + p.y)];
  if (new Set(idx).size < 4) idx = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)];
  const area = (ids: number[]) => polygonArea(ids.map((i) => hull[i]));
  let best = area(idx);
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let k = 0; k < 4; k++) {
      for (let c = 0; c < n; c++) {
        if (idx.includes(c)) continue;
        const trial = [...idx];
        trial[k] = c;
        const sortedTrial = [...trial].sort((a, b) => a - b);
        const a = area(sortedTrial);
        if (a > best + 1e-6) {
          best = a;
          idx = sortedTrial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return orderQuad(idx.map((i) => hull[i]));
}

// ------------------------------------------------------------------ détection

/**
 * Cherche la feuille dans la photo : on sépare la zone claire et peu colorée
 * (le papier) du fond, on garde la plus grande région, puis on l'approche par
 * un quadrilatère. Renvoie des coordonnées dans l'image fournie, ou null si
 * rien ne ressemble à une feuille.
 */
export function detectDocument(img: Pixels, work = 256): Quad | null {
  const small = downscale(img, work);
  const { width: w, height: h } = small;
  // « Papier » : lumineux et peu saturé.
  const paper = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    const r = small.data[i], g = small.data[i + 1], b = small.data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    paper[p] = 0.299 * r + 0.587 * g + 0.114 * b - 0.6 * (max - min);
  }
  // Le flou efface le texte imprimé pour que la feuille forme une seule région.
  const blurred = boxBlur(boxBlur(paper, w, h, 2), w, h, 2);
  const hist = new Uint32Array(256);
  for (const v of blurred) hist[clamp(Math.round(v), 0, 255)]++;
  const t = otsu(hist, w * h);
  // Contraste trop faible : feuille blanche sur fond blanc, ou aucune feuille.
  let lo = 0, hi = 0, nlo = 0, nhi = 0;
  for (let i = 0; i < 256; i++) {
    if (i <= t) (lo += i * hist[i]), (nlo += hist[i]);
    else (hi += i * hist[i]), (nhi += hist[i]);
  }
  if (!nlo || !nhi || hi / nhi - lo / nlo < 25) return null;
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) mask[p] = blurred[p] > t ? 1 : 0;

  // Plus grande région claire (4-connexité), en privilégiant celle qui couvre le centre.
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let bestRegion = -1, bestScore = 0;
  const regions: number[][] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = regions.length;
    const pixels: number[] = [];
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && label[p - 1] < 0) (label[p - 1] = id), stack.push(p - 1);
      if (x < w - 1 && mask[p + 1] && label[p + 1] < 0) (label[p + 1] = id), stack.push(p + 1);
      if (y > 0 && mask[p - w] && label[p - w] < 0) (label[p - w] = id), stack.push(p - w);
      if (y < h - 1 && mask[p + w] && label[p + w] < 0) (label[p + w] = id), stack.push(p + w);
    }
    regions.push(pixels);
    const center = Math.floor(h / 2) * w + Math.floor(w / 2);
    const score = pixels.length * (label[center] === id ? 1.5 : 1);
    if (score > bestScore) (bestScore = score), (bestRegion = id);
  }
  if (bestRegion < 0) return null;
  const region = regions[bestRegion];
  if (region.length < w * h * 0.12) return null;

  // Bord de la région → enveloppe convexe → quadrilatère.
  const boundary: Point[] = [];
  for (const p of region) {
    const x = p % w, y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - w] || !mask[p + w]) {
      boundary.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  const hull = convexHull(boundary);
  const quad = bestQuad(hull);
  if (!quad) return null;
  const quadArea = polygonArea(quad);
  // La région doit vraiment ressembler à un quadrilatère.
  if (quadArea < w * h * 0.12 || region.length / quadArea < 0.8) return null;
  const sx = img.width / w, sy = img.height / h;
  return quad.map((p) => ({ x: clamp(p.x * sx, 0, img.width), y: clamp(p.y * sy, 0, img.height) })) as Quad;
}

/** Cadre par défaut quand rien n'est détecté : toute la photo avec une petite marge. */
export function defaultQuad(width: number, height: number, margin = 0.04): Quad {
  const mx = width * margin, my = height * margin;
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}

// ------------------------------------------------------------------ redressement

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Taille de la page redressée, plafonnée à `max` pixels sur le plus grand côté. */
export function outputSize(q: Quad, max = 2200): { width: number; height: number } {
  let width = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let height = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const f = Math.min(1, max / Math.max(width, height));
  width = Math.max(1, Math.round(width * f));
  height = Math.max(1, Math.round(height * f));
  return { width, height };
}

/**
 * Homographie qui envoie le rectangle (0,0)-(w,h) sur le quadrilatère q :
 * renvoie les 8 coefficients [a b c d e f g h] de
 * x' = (a x + b y + c) / (g x + h y + 1), y' = (d x + e y + f) / (g x + h y + 1).
 */
export function homography(w: number, h: number, q: Quad): number[] {
  const src = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const { x: X, y: Y } = q[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    B.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    B.push(Y);
  }
  return solve(A, B);
}

/** Élimination de Gauss avec pivot partiel. */
function solve(A: number[][], B: number[]): number[] {
  const n = B.length;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Redresse la zone q de l'image en une page de width × height (interpolation bilinéaire). */
export function warp(img: Pixels, q: Quad, width: number, height: number): Pixels {
  const [a, b, c, d, e, f, g, hh] = homography(width, height, q);
  const out = new Uint8ClampedArray(width * height * 4);
  const W = img.width, H = img.height, src = img.data;
  let o = 0;
  for (let y = 0; y < height; y++) {
    const yc = y + 0.5;
    for (let x = 0; x < width; x++, o += 4) {
      const xc = x + 0.5;
      const den = g * xc + hh * yc + 1;
      const sx = clamp((a * xc + b * yc + c) / den - 0.5, 0, W - 1);
      const sy = clamp((d * xc + e * yc + f) / den - 0.5, 0, H - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src[i00 + k] + (src[i10 + k] - src[i00 + k]) * fx;
        const bot = src[i01 + k] + (src[i11 + k] - src[i01 + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** Rotation par quart de tour (sens horaire). */
export function rotate90(img: Pixels, quarters: number): Pixels {
  const q = ((quarters % 4) + 4) % 4;
  if (!q) return img;
  const { width: w, height: h, data } = img;
  const W = q % 2 ? h : w, H = q % 2 ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [X, Y] = q === 1 ? [h - 1 - y, x] : q === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const i = (y * w + x) * 4, o = (Y * W + X) * 4;
      out[o] = data[i];
      out[o + 1] = data[i + 1];
      out[o + 2] = data[i + 2];
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

// ------------------------------------------------------------------ nettoyage

/**
 * Éclairage du papier estimé par canal : maximum par blocs (le texte, plus
 * sombre, disparaît), dilatation, flou, puis agrandissement bilinéaire.
 */
function paperLight(img: Pixels, channel: (i: number) => number): Float32Array {
  const { width: W, height: H } = img;
  const block = Math.max(4, Math.round(Math.max(W, H) / 96));
  const w = Math.ceil(W / block), h = Math.ceil(H / block);
  const grid = new Float32Array(w * h);
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      // 95e centile approché du bloc : plus robuste au bruit qu'un maximum strict.
      const vals: number[] = [];
      for (let y = by * block; y < Math.min(H, (by + 1) * block); y += 2) {
        for (let x = bx * block; x < Math.min(W, (bx + 1) * block); x += 2) vals.push(channel((y * W + x) * 4));
      }
      vals.sort((a, b) => a - b);
      grid[by * w + bx] = vals[Math.floor(vals.length * 0.95)] ?? 255;
    }
  }
  // Dilatation : les blocs couverts d'encre (titres, aplats) prennent la lumière de leurs voisins.
  const dil = new Float32Array(w * h);
  const r = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) m = Math.max(m, grid[yy * w + xx]);
      }
      dil[y * w + x] = m;
    }
  }
  const smooth = boxBlur(dil, w, h, 2);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const gy = clamp((y + 0.5) / block - 0.5, 0, h - 1);
    const y0 = Math.floor(gy), y1 = Math.min(h - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = clamp((x + 0.5) / block - 0.5, 0, w - 1);
      const x0 = Math.floor(gx), x1 = Math.min(w - 1, x0 + 1), fx = gx - x0;
      const top = smooth[y0 * w + x0] + (smooth[y0 * w + x1] - smooth[y0 * w + x0]) * fx;
      const bot = smooth[y1 * w + x0] + (smooth[y1 * w + x1] - smooth[y1 * w + x0]) * fx;
      out[y * W + x] = Math.max(24, top + (bot - top) * fy);
    }
  }
  return out;
}

/** Courbe de contraste : le papier devient blanc, l'encre reste nette. */
const tone = (ratio: number) => {
  const t = clamp((ratio - 0.22) / (0.88 - 0.22), 0, 1);
  return 255 * Math.pow(t, 1.35);
};

/** Applique le filtre : ombres retirées, fond blanchi ; « original » ne change rien. */
export function enhance(img: Pixels, filter: ScanFilter): Pixels {
  if (filter === "original") return img;
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  if (filter === "auto") {
    // Chaque canal est divisé par l'éclairage du papier : ombres et dominante de couleur disparaissent.
    const light = [0, 1, 2].map((k) => paperLight(img, (i) => data[i + k]));
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      for (let k = 0; k < 3; k++) out[i + k] = tone(data[i + k] / light[k][p]);
      out[i + 3] = 255;
    }
    return { data: out, width: W, height: H };
  }
  const light = paperLight(img, lum);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const ratio = lum(i) / light[p];
    // Noir et blanc : seuil avec une courte rampe pour garder des bords lisses.
    const v = filter === "bw" ? 255 * clamp((ratio - 0.62) / 0.16, 0, 1) : tone(ratio);
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width: W, height: H };
}
