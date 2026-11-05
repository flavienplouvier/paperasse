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
  width?: number;
}

export type Align = "left" | "center" | "right" | "justify";

export interface BlockLine {
  /** Début de la ligne de base. */
  origin: Point;
  width: number;
  text: string;
  /** Police (nom pdf.js) de chaque caractère de `text`. */
  fonts: string[];
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
  /** Texte du bloc, lignes recollées par une espace (la coupure se refait à la mise en page). */
  text: string;
  /** Police (nom pdf.js) de chaque caractère de `text` : gras, liens, symboles… */
  fonts: string[];
  /** Largeur réelle d'une espace entre deux mots dans le PDF (points), si mesurable. */
  space?: number;
}

const right = (p: Piece) => p.baseline[0] + (p.width ?? 0);

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
      // Caractères et police de chacun ; les blancs consécutifs sont réduits à une espace.
      const chars: { ch: string; font: string }[] = [];
      const push = (ch: string, font: string) => {
        const space = /\s/.test(ch);
        if (space && (!chars.length || chars[chars.length - 1].ch === " ")) return;
        chars.push({ ch: space ? " " : ch, font });
      };
      for (const [i, p] of cur.entries()) {
        if (i) {
          const gap = p.baseline[0] - right(cur[i - 1]);
          // Espace implicite (mots positionnés sans caractère espace).
          if (gap > 0.15 * p.fontSize && !p.str.startsWith(" ")) push(" ", cur[i - 1].fontName);
        }
        for (const ch of p.str) push(ch, p.fontName);
      }
      while (chars.length && chars[chars.length - 1].ch === " ") chars.pop();
      const trimmed = chars.map((c) => c.ch).join("");
      if (trimmed) {
        const first = cur.find((p) => p.str.trim()) ?? cur[0];
        const last = [...cur].reverse().find((p) => p.str.trim()) ?? cur[cur.length - 1];
        lines.push({
          origin: [first.baseline[0], first.baseline[1]],
          width: right(last) - first.baseline[0],
          text: trimmed,
          fonts: chars.map((c) => c.font),
          fontSize: Math.max(...cur.map((p) => p.fontSize)),
          pieces: cur,
        });
      }
      cur = [];
    };
    for (const p of row) {
      // Blanc très large (tabulation placée comme une espace) : séparation de colonnes.
      if (!p.str.trim() && (p.width ?? 0) > 1.2 * p.fontSize) {
        flush();
        continue;
      }
      // Écart mesuré depuis le dernier mot (pas depuis une espace).
      const prev = [...cur].reverse().find((x) => x.str.trim());
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
  const centers = lefts.map((l, i) => (l + rights[i]) / 2);
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
    // Écart réel entre deux mots (le PDF place souvent chaque mot lui-même) : médiane.
    const gaps: number[] = [];
    for (const l of g) {
      const words = l.pieces.filter((p) => p.str.trim());
      for (let k = 1; k < words.length; k++) {
        const prev = words[k - 1];
        const cur = words[k];
        const gap = cur.baseline[0] - right(prev);
        // Mots voisins séparés par un vide (espace placée ou implicite), sans espace dans le texte lui-même.
        if (gap > 0.15 * fontSize && gap < 1.2 * fontSize && !/\s$/.test(prev.str) && !/^\s/.test(cur.str)) gaps.push(gap);
      }
    }
    gaps.sort((a, b) => a - b);
    const space = gaps.length >= 2 ? gaps[Math.floor(gaps.length / 2)] : undefined;
    return {
      ...(space ? { space } : {}),
      lines: g,
      rect: [left, bottom, rightEdge, top],
      fontName: dominantFont(g),
      fontSize,
      lineHeight,
      align: detectAlign(g, 0.8 * fontSize),
      left,
      width: rightEdge - left,
      ...joinLines(g, rightEdge),
    };
  });
}

/** Début d'élément de liste : puce, flèche, tiret, numéro. */
const BULLET = /^([–—•→▪●◦■□*-]|\(?\d{1,2}[.)\]]|\d{1,3}(\.\d{1,3})+\.?|\[\d{1,2}\]|[a-z][.)])\s/u;

/**
 * Texte du bloc : une ligne d'origine = une ligne du texte (séparées par des
 * retours à la ligne), pour que le bloc s'ouvre exactement comme dans le PDF.
 * Seule une ligne devenue trop longue se coupe à la mise en page ;
 * `reflowText` recolle à la demande les lignes d'un même paragraphe.
 */
export function joinLines(lines: BlockLine[], _rightEdge?: number): { text: string; fonts: string[] } {
  let text = "";
  const fonts: string[] = [];
  lines.forEach((l, i) => {
    if (i) {
      const prev = lines[i - 1];
      text += "\n";
      fonts.push(prev.fonts[prev.fonts.length - 1]);
    }
    text += l.text;
    fonts.push(...l.fonts);
  });
  return { text, fonts };
}

/** Le retour à la ligne entre ces deux lignes est-il interne à un paragraphe ? */
export function continues(prev: string, next: string): boolean {
  return !!prev.trim() && !!next.trim() && !BULLET.test(next) && !/[.:;!?…»)]$/.test(prev.trimEnd());
}

/**
 * Recolle les lignes d'un même paragraphe (retour à la ligne remplacé par une
 * espace, même longueur : les styles restent en place) ; les éléments de liste
 * et les fins de phrase gardent leur retour à la ligne.
 */
export function reflowText(text: string): string {
  const lines = text.split("\n");
  return lines.map((l, i) => (i < lines.length - 1 ? l + (continues(l, lines[i + 1]) ? " " : "\n") : l)).join("");
}

// ------------------------------------------------------------------ styles mélangés

/** Plage du texte écrite dans une autre police que la principale (index dans la liste des polices). */
export interface StyleRange {
  start: number;
  end: number;
  font: number;
}

/** Police de chaque caractère → plages pour les polices autres que `main`, et liste de ces polices. */
export function stylesFromFonts(fonts: string[], main: string): { styles: StyleRange[]; names: string[] } {
  const names: string[] = [];
  const styles: StyleRange[] = [];
  fonts.forEach((f, i) => {
    if (f === main) return;
    let k = names.indexOf(f);
    if (k < 0) k = names.push(f) - 1;
    const last = styles[styles.length - 1];
    if (last && last.font === k && last.end === i) last.end = i + 1;
    else styles.push({ start: i, end: i + 1, font: k });
  });
  return { styles, names };
}

/** Index de police d'un caractère (-1 = police principale). */
export function fontIndexAt(styles: StyleRange[] | undefined, i: number): number {
  return styles?.find((r) => i >= r.start && i < r.end)?.font ?? -1;
}

/**
 * Suit une modification du texte : la partie commune au début et à la fin
 * garde ses styles ; le texte inséré prend le style du caractère qui le
 * précède (ou qui le suit, en tout début).
 */
export function shiftStyles(styles: StyleRange[], before: string, after: string): StyleRange[] {
  if (!styles.length || before === after) return styles;
  let pre = 0;
  while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
  let suf = 0;
  while (suf < before.length - pre && suf < after.length - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  const oldFonts = [...Array(before.length).keys()].map((i) => fontIndexAt(styles, i));
  const inserted = after.length - pre - suf;
  const inherit = pre > 0 ? oldFonts[pre - 1] : (oldFonts[before.length - suf] ?? -1);
  const fonts = [...oldFonts.slice(0, pre), ...Array<number>(inserted).fill(inherit), ...oldFonts.slice(before.length - suf)];
  const out: StyleRange[] = [];
  fonts.forEach((f, i) => {
    if (f < 0) return;
    const last = out[out.length - 1];
    if (last && last.font === f && last.end === i) last.end = i + 1;
    else out.push({ start: i, end: i + 1, font: f });
  });
  return out;
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
  /** Position du début de la ligne dans le texte complet. */
  start: number;
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
 * `measure(s, offset)` mesure `s` situé à `offset` dans le texte (styles mélangés).
 */
export function layoutText(text: string, maxWidth: number, align: Align, measure: (s: string, offset: number) => number): LaidLine[] {
  const out: LaidLine[] = [];
  let offset = 0;
  const paras = text.split("\n");
  for (const [p, para] of paras.entries()) {
    // Ligne d'origine suivie d'une autre ligne du même paragraphe : justifiée elle aussi.
    const goesOn = p < paras.length - 1 && continues(para, paras[p + 1]);
    type Word = { w: string; at: number };
    const words: Word[] = [];
    let at = offset;
    for (const w of para.split(" ")) {
      if (w) words.push({ w, at });
      at += w.length + 1;
    }
    const lines: Word[][] = [];
    let cur: Word[] = [];
    const span = (ws: Word[]) => text.slice(ws[0].at, ws[ws.length - 1].at + ws[ws.length - 1].w.length);
    for (let word of words) {
      // Mot plus large que la ligne : coupé en morceaux.
      while (measure(word.w, word.at) > maxWidth && word.w.length > 1) {
        let n = word.w.length - 1;
        while (n > 1 && measure(word.w.slice(0, n), word.at) > maxWidth) n--;
        if (cur.length) lines.push(cur), (cur = []);
        lines.push([{ w: word.w.slice(0, n), at: word.at }]);
        word = { w: word.w.slice(n), at: word.at + n };
      }
      // Petite tolérance : une ligne d'origine ne doit pas se couper pour un arrondi de mesure.
      if (cur.length && measure(span([...cur, word]), cur[0].at) > maxWidth * 1.015 + 0.01) {
        lines.push(cur);
        cur = [word];
      } else cur.push(word);
    }
    lines.push(cur);
    lines.forEach((ws, i) => {
      const start = ws.length ? ws[0].at : offset;
      const line = ws.length ? span(ws) : "";
      const width = line ? measure(line, start) : 0;
      const free = Math.max(0, maxWidth - width);
      // Dernière ligne d'un paragraphe : pas étirée, sauf si le paragraphe continue et qu'elle est presque pleine.
      const last = i === lines.length - 1 && !(goesOn && width > maxWidth * 0.7);
      const spaces = ws.length - 1;
      if (align === "justify" && !last && spaces > 0) out.push({ text: line, start, x: 0, wordSpacing: free / spaces, width: maxWidth });
      else out.push({ text: line, start, x: align === "center" ? free / 2 : align === "right" ? free : 0, wordSpacing: 0, width });
    });
    offset += para.length + 1;
  }
  return out;
}
