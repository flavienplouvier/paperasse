import type { PDFPageProxy } from "./pdfjs";
import type { Point, Rect } from "./types";

/** Fragment de texte d'une page, en espace PDF. */
export interface TextRun {
  str: string;
  rect: Rect;
  baseline: Point;
  fontSize: number;
  /** Nom interne pdf.js (ex. « g_d0_f3 »). */
  fontName: string;
  /** Direction du texte dans l'espace PDF, en degrés (0 = horizontal). */
  angle: number;
}

interface RawItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
}

export async function extractRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const raw of content.items as RawItem[]) {
    if (!raw.str || !raw.transform || !raw.str.trim()) continue;
    const [a, b, c, d, e, f] = raw.transform;
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b);
    const angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
    const width = raw.width ?? 0;
    let rect: Rect;
    if (angle === 0) {
      rect = [e, f - fontSize * 0.25, e + width, f + fontSize * 0.95];
    } else {
      // Texte tourné : boîte englobante approximative.
      const rad = (angle * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const corners: Point[] = [
        [e - uy * fontSize * -0.25, f + ux * -0.25 * fontSize],
        [e + ux * width, f + uy * width],
        [e - uy * fontSize * 0.95, f + ux * fontSize * 0.95],
        [e + ux * width - uy * fontSize * 0.95, f + uy * width + ux * fontSize * 0.95],
      ];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    runs.push({ str: raw.str, rect, baseline: [e, f], fontSize, fontName: raw.fontName ?? "", angle });
  }
  return runs;
}

export function runAt(runs: TextRun[], p: Point): TextRun | undefined {
  let best: TextRun | undefined;
  let bestArea = Infinity;
  for (const r of runs) {
    const [x1, y1, x2, y2] = r.rect;
    if (p[0] >= x1 - 1 && p[0] <= x2 + 1 && p[1] >= y1 - 1 && p[1] <= y2 + 1) {
      const area = (x2 - x1) * (y2 - y1);
      if (area < bestArea) {
        best = r;
        bestArea = area;
      }
    }
  }
  return best;
}

export interface SearchHit {
  pageIndex: number;
  rect: Rect;
  context: string;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Recherche insensible à la casse et aux accents ; position estimée dans le fragment. */
export function searchRuns(runs: TextRun[], pageIndex: number, query: string): SearchHit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const r of runs) {
    const text = fold(r.str);
    let from = 0;
    for (;;) {
      const i = text.indexOf(q, from);
      if (i < 0) break;
      from = i + q.length;
      const n = text.length || 1;
      let rect = r.rect;
      if (r.angle === 0) {
        const w = r.rect[2] - r.rect[0];
        rect = [r.rect[0] + (w * i) / n, r.rect[1], r.rect[0] + (w * (i + q.length)) / n, r.rect[3]];
      }
      const start = Math.max(0, i - 30);
      hits.push({
        pageIndex,
        rect,
        context: `${start > 0 ? "…" : ""}${r.str.slice(start, i + q.length + 30)}`,
      });
    }
  }
  return hits;
}
