import type { PDFPageProxy } from "./pdfjs";

/**
 * Traits fins de la page (bordures de tableau, filets), en espace PDF :
 * le texte n'est jamais regroupé de part et d'autre d'un trait.
 */
export interface Rule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  vertical: boolean;
}

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Épaisseur maximale d'un trait, longueur minimale. */
const THIN = 2.5;
const LONG = 4;

function ruleOf(x1: number, y1: number, x2: number, y2: number): Rule | null {
  const [l, r] = x1 < x2 ? [x1, x2] : [x2, x1];
  const [b, t] = y1 < y2 ? [y1, y2] : [y2, y1];
  const w = r - l;
  const h = t - b;
  if (w <= THIN && h >= LONG) return { x1: l, y1: b, x2: r, y2: t, vertical: true };
  if (h <= THIN && w >= LONG) return { x1: l, y1: b, x2: r, y2: t, vertical: false };
  return null;
}

/** Codes pdf.js utiles (passés en paramètre pour pouvoir tester sans pdf.js). */
export interface OpCodes {
  constructPath: number;
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
}

/** Sous-commandes d'un tracé pdf.js (DrawOPS). */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

export function rulesFromOps(fnArray: ArrayLike<number>, argsArray: unknown[], ops: OpCodes): Rule[] {
  const strokes = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const fills = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const out: Rule[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = multiply(ctm, args as unknown as Matrix);
    else if (fn === ops.paintFormXObjectBegin && args) {
      stack.push(ctm);
      const m = args[0] as Matrix | null;
      if (m) ctm = multiply(ctm, m);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.constructPath && args) {
      const op = args[0] as number;
      const data = (args[1] as ArrayLike<number>[] | null)?.[0];
      if (!data || (!strokes.has(op) && !fills.has(op))) continue;
      const pts = (k: number) => apply(ctm, data[k], data[k + 1]);
      // Rectangle plein très fin : un trait.
      if (fills.has(op)) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let k = 0; k < data.length; ) {
          const cmd = data[k++];
          const n = cmd === MOVE || cmd === LINE ? 1 : cmd === CURVE ? 3 : cmd === QUAD ? 2 : 0;
          for (let j = 0; j < n; j++, k += 2) {
            const [x, y] = pts(k);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
        const r = minX <= maxX ? ruleOf(minX, minY, maxX, maxY) : null;
        if (r) out.push(r);
      }
      // Tracé : chaque segment droit horizontal ou vertical.
      if (strokes.has(op)) {
        let start: [number, number] | null = null;
        let cur: [number, number] | null = null;
        for (let k = 0; k < data.length; ) {
          const cmd = data[k++];
          if (cmd === MOVE) {
            cur = start = pts(k);
            k += 2;
          } else if (cmd === LINE) {
            const p = pts(k);
            k += 2;
            if (cur) {
              const r = ruleOf(cur[0], cur[1], p[0], p[1]);
              if (r) out.push(r);
            }
            cur = p;
          } else if (cmd === CURVE) {
            cur = pts(k + 4);
            k += 6;
          } else if (cmd === QUAD) {
            cur = pts(k + 2);
            k += 4;
          } else if (cmd === CLOSE) {
            if (cur && start) {
              const r = ruleOf(cur[0], cur[1], start[0], start[1]);
              if (r) out.push(r);
            }
            cur = start;
          } else break;
        }
      }
    }
  }
  return out;
}

export async function extractRules(page: PDFPageProxy): Promise<Rule[]> {
  try {
    const [{ pdfjs }, list] = await Promise.all([import("./pdfjs"), page.getOperatorList()]);
    return rulesFromOps(list.fnArray, list.argsArray, pdfjs.OPS as unknown as OpCodes);
  } catch {
    return [];
  }
}

/** Un trait vertical sépare-t-il deux morceaux d'une même ligne (entre x1 et x2, à la hauteur de la ligne) ? */
export function verticalBetween(rules: Rule[], x1: number, x2: number, yLow: number, yHigh: number): boolean {
  return rules.some((r) => r.vertical && r.x2 >= x1 - 0.5 && r.x1 <= x2 + 0.5 && r.y1 < yHigh && r.y2 > yLow);
}

/** Un trait horizontal sépare-t-il deux lignes (entre y1 et y2, sur la largeur commune) ? */
export function horizontalBetween(rules: Rule[], y1: number, y2: number, xLeft: number, xRight: number): boolean {
  return rules.some((r) => !r.vertical && r.y2 > y1 && r.y1 < y2 && r.x1 < xRight && r.x2 > xLeft);
}
