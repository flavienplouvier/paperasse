import type { Point, Rect } from "./types";

/**
 * Blocs de texte : un PDF n'écrit pas des paragraphes mais des morceaux de
 * texte placés un à un (souvent mot par mot pour un texte justifié). On les
 * recolle en lignes, puis les lignes en blocs (titre sur deux lignes,
 * paragraphe), pour les modifier d'un seul tenant et les remettre en page.
 */

/** Morceau de texte du PDF (voir `TextRun` dans text.ts). */
export interface Piece {
  str: string;
  /** Origine de la ligne de base. */
  baseline: Point;
  fontSize: number;
  fontName: string;
  /** Degrés ; seuls les blocs horizontaux (0) sont reconstitués. */
  angle: number;
  width: number;
}

export type Align = "left" | "center" | "right" | "justify";

export interface BlockLine {
  /** Début de la ligne de base. */
  origin: Point;
  width: number;
  text: string;
  fontSize: number;
  pieces: Piece[];
}

export interface TextBlock {
  lines: BlockLine[];
  /** Cadre englobant (repère PDF). */
  rect: Rect;
  /** Police la plus présente (en nombre de caractères). */
  fontName: string;
  fontSize: number;
  /** Écart entre deux lignes de base (points) ; corps × 1,2 pour une seule ligne. */
  lineHeight: number;
  align: Align;
  /** Bord gauche et largeur du bloc. */
  left: number;
  width: number;
  /** Texte du bloc, lignes recollées par une espace (le retour à la ligne se refait à la mise en page). */
  text: string;
}

const right = (p: Piece) => p.baseline[0] + p.width;

/** Morceaux d'une même ligne recollés ; un grand écart (colonne, case de tableau) coupe la ligne. */
export function groupLines(pieces: Piece[]): BlockLine[] {
  const flat = pieces.filter((p) => p.angle === 0 && p.str.length && p.fontSize > 0);
  // Regroupement par ligne de base.
  const rows: Piece[][] = [];
  for (const p of [...flat].sort((a, b) => b.baseline[1] - a.baseline[1] || a.baseline[0] - b.baseline[0])) {
    const row = rows.find((r) => Math.abs(r[0].baseline[1] - p.baseline[1]) < 0.3 * Math.min(r[0].fontSize, p.fontSize) && Math.abs(r[0].fontSize - p.fontSize) < 0.25 * r[0].fontSize);
    if (row) row.push(p);
    else rows.push([p]);
  }
  const lines: BlockLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.baseline[0] - b.baseline[0]);
    let cur: Piece[] = [];
    const flush = () => {
      if (!cur.length) return;
      let text = "";
      for (const [i, p] of cur.entries()) {
        if (i) {
          const gap = p.baseline[0] - right(cur[i - 1]);
          // Espace implicite (mots positionnés sans caractère espace).
          if (gap > 0.15 * p.fontSize && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
        }
        text += p.str;
      }
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (trimmed) {
        const first = cur.find((p) => p.str.trim()) ?? cur[0];
        const last = [...cur].reverse().find((p) => p.str.trim()) ?? cur[cur.length - 1];
        lines.push({ origin: [first.baseline[0], first.baseline[1]], width: right(last) - first.baseline[0], text: trimmed, fontSize: Math.max(...cur.map((p) => p.fontSize)), pieces: cur });
      }
      cur = [];
    };
    for (const p of row) {
      const prev = cur[cur.length - 1];
      if (prev && p.baseline[0] - right(prev) > 1.2 * p.fontSize) flush();
      cur.push(p);
    }
    flush();
  }
  return lines;
}

function dominantFont(lines: BlockLine[]): string {
  const count = new Map<string, number>();
  for (const l of lines) for (const p of l.pieces) if (p.str.trim()) count.set(p.fontName, (count.get(p.fontName) ?? 0) + p.str.trim().length);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function detectAlign(lines: BlockLine[], tol: number): Align {
  if (lines.length < 2) return "left";
  const lefts = lines.map((l) => l.origin[0]);
  const rights = lines.map((l) => l.origin[0] + l.width);
  const centers = lines.map((l, i) => (lefts[i] + rights[i]) / 2);
  const same = (v: number[]) => Math.max(...v) - Math.min(...v) < tol;
  const maxRight = Math.max(...rights);
  if (same(lefts)) {
    // Justifié : toutes les lignes sauf la dernière vont jusqu'au bord droit.
    const body = rights.slice(0, -1);
    return lines.length >= 2 && body.every((r) => maxRight - r < tol) && lines.slice(0, -1).every((l) => l.text.includes(" ")) && maxRight - rights[rights.length - 1] > tol ? "justify" : "left";
  }
  if (same(centers)) return "center";
  if (same(rights)) return "right";
  return "left";
}

/** Lignes regroupées en blocs : même corps, interligne régulier, bords alignés ou centrés. */
export function groupBlocks(lines: BlockLine[]): TextBlock[] {
  const ordered = [...lines].sort((a, b) => b.origin[1] - a.origin[1] || a.origin[0] - b.origin[0]);
  const groups: BlockLine[][] = [];
  for (const line of ordered) {
    const fit = groups.find((g) => {
      const last = g[g.length - 1];
      const size = last.fontSize;
      if (Math.abs(line.fontSize - size) > 0.15 * size) return false;
      const step = last.origin[1] - line.origin[1];
      if (step < 0.9 * size || step > 1.9 * size) return false;
      if (g.length >= 2) {
        const prevStep = g[g.length - 2].origin[1] - last.origin[1];
        if (Math.abs(step - prevStep) > 0.2 * size) return false;
      }
      const l0 = last.origin[0], r0 = l0 + last.width, l1 = line.origin[0], r1 = l1 + line.width;
      const overlap = Math.min(r0, r1) - Math.max(l0, l1);
      if (overlap < 0.3 * Math.min(r0 - l0, r1 - l1)) return false;
      const tol = 0.8 * size;
      return Math.abs(l0 - l1) < tol || Math.abs((l0 + r0) / 2 - (l1 + r1) / 2) < tol || Math.abs(r0 - r1) < tol;
    });
    if (fit) fit.push(line);
    else groups.push([line]);
  }
  return groups.map((g) => {
    const fontSize = g[0].fontSize;
    const left = Math.min(...g.map((l) => l.origin[0]));
    const rightEdge = Math.max(...g.map((l) => l.origin[0] + l.width));
    const top = g[0].origin[1] + fontSize * 0.95;
    const bottom = g[g.length - 1].origin[1] - fontSize * 0.25;
    const lineHeight = g.length > 1 ? (g[0].origin[1] - g[g.length - 1].origin[1]) / (g.length - 1) : fontSize * 1.2;
    return {
      lines: g,
      rect: [left, bottom, rightEdge, top],
      fontName: dominantFont(g),
      fontSize,
      lineHeight,
      align: detectAlign(g, 0.8 * fontSize),
      left,
      width: rightEdge - left,
      text: joinLines(g, rightEdge),
    };
  });
}

/** Début d'élément de liste : puce, flèche, tiret, numéro. */
const BULLET = /^([–—•→▪●◦■□*-]|\(?\d{1,2}[.)\]]|\[\d{1,2}\]|[a-z][.)])\s/u;

/**
 * Texte du bloc : les lignes d'un même paragraphe sont recollées par une
 * espace (la coupure se refait à la mise en page) ; un retour à la ligne est
 * gardé avant un élément de liste et après une ligne courte qui finit une phrase.
 */
export function joinLines(lines: BlockLine[], rightEdge: number): string {
  let text = "";
  lines.forEach((l, i) => {
    if (i) {
      const prev = lines[i - 1];
      const short = rightEdge - (prev.origin[0] + prev.width) > 2 * l.fontSize;
      const hard = BULLET.test(l.text) || (short && /[.:;!?…»)]$/.test(prev.text));
      text += hard ? "\n" : " ";
    }
    text += l.text;
  });
  return text.replace(/[ \t]+/g, " ").trim();
}

export function blocksOf(pieces: Piece[]): TextBlock[] {
  return groupBlocks(groupLines(pieces));
}

/** Bloc qui contient le point (le plus petit s'il y en a plusieurs). */
export function blockAt(blocks: TextBlock[], p: Point, margin = 1): TextBlock | undefined {
  let best: TextBlock | undefined;
  let area = Infinity;
  for (const b of blocks) {
    const [x1, y1, x2, y2] = b.rect;
    if (p[0] >= x1 - margin && p[0] <= x2 + margin && p[1] >= y1 - margin && p[1] <= y2 + margin) {
      const a = (x2 - x1) * (y2 - y1);
      if (a < area) (best = b), (area = a);
    }
  }
  return best;
}

// ------------------------------------------------------------------ mise en page

export interface LaidLine {
  text: string;
  /** Décalage depuis le bord gauche du bloc. */
  x: number;
  /** Espace supplémentaire ajouté à chaque espace (justification). */
  wordSpacing: number;
  width: number;
}

/**
 * Remet un texte en page dans une largeur : coupure aux espaces (un mot trop
 * long est coupé), retours à la ligne voulus conservés, alignement ; en
 * justifié, la dernière ligne de chaque paragraphe reste alignée à gauche.
 */
export function layoutText(text: string, maxWidth: number, align: Align, measure: (s: string) => number): LaidLine[] {
  const out: LaidLine[] = [];
  const spaceW = measure(" ");
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(" ").filter((w, i, all) => w || all.length === 1);
    const lines: string[][] = [];
    let cur: string[] = [];
    let curW = 0;
    for (let word of words) {
      let w = measure(word);
      // Mot plus large que la ligne : coupé en morceaux.
      while (w > maxWidth && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && measure(word.slice(0, n)) > maxWidth) n--;
        if (cur.length) lines.push(cur), (cur = []), (curW = 0);
        lines.push([word.slice(0, n)]);
        word = word.slice(n);
        w = measure(word);
      }
      const add = cur.length ? spaceW + w : w;
      if (cur.length && curW + add > maxWidth + 0.01) {
        lines.push(cur);
        cur = [word];
        curW = w;
      } else {
        cur.push(word);
        curW += add;
      }
    }
    lines.push(cur);
    lines.forEach((ws, i) => {
      const line = ws.join(" ");
      const width = measure(line);
      const free = Math.max(0, maxWidth - width);
      const last = i === lines.length - 1;
      const spaces = ws.length - 1;
      if (align === "justify" && !last && spaces > 0) out.push({ text: line, x: 0, wordSpacing: free / spaces, width: maxWidth });
      else out.push({ text: line, x: align === "center" ? free / 2 : align === "right" ? free : 0, wordSpacing: 0, width });
    });
  }
  return out;
}
