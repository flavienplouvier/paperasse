import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import { Encodings, Font as StandardFont, type IFontNames } from "@pdf-lib/standard-fonts";
import type { Rect, TextLine } from "./types";

/** Zone à vider : une ligne de texte d'origine (« Modifier le texte ») ou un rectangle (cache blanc). */
export type RemovalZone = TextLine | { rect: Rect };

/**
 * Suppression réelle du texte d'origine (« Modifier le texte »).
 *
 * Le flux de contenu de la page est analysé ; chaque caractère affiché est
 * positionné (matrices de texte et de transformation, police, espacements).
 * Les caractères qui tombent dans une des zones demandées sont retirés du flux
 * et remplacés par un décalage de même largeur : le reste de la ligne ne bouge
 * pas. Le texte supprimé n'existe plus dans le fichier (ni copiable, ni
 * indexable).
 *
 * Limites : texte placé dans un XObject de formulaire, police à encodage CMap
 * non standard ou largeurs inconnues → le texte n'est pas retiré et le résultat
 * l'indique (l'appelant garde alors le cache blanc).
 */

export interface RemovalResult {
  /** Caractères visibles retirés dans la zone. */
  removed: number;
  /** Caractères invisibles retirés (couche OCR d'un scan : l'image montre encore l'ancien texte). */
  invisible: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a × b (convention PDF : vecteurs ligne, a appliquée d'abord). */
function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

// ------------------------------------------------------------------ lecture du flux

type Operand = number | string | Uint8Array | Operand[] | { name: string } | null | boolean;
interface Op {
  op: string;
  args: Operand[];
  /** Position du premier opérande (ou de l'opérateur) et fin de l'opérateur. */
  start: number;
  end: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

class Lexer {
  pos = 0;
  constructor(private b: Uint8Array) {}

  private skipSpace() {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  private regular(): string {
    const b = this.b;
    const s = this.pos;
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
    return String.fromCharCode(...b.subarray(s, this.pos));
  }

  private literal(): Uint8Array {
    const b = this.b;
    const out: number[] = [];
    let depth = 1;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 92) {
        const n = b[this.pos++];
        const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (n in map) out.push(map[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let i = 0; i < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; i++) v = v * 8 + b[this.pos++] - 48;
          out.push(v & 255);
        } else if (n === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (n !== 10) out.push(n);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  }

  private hex(): Uint8Array {
    const b = this.b;
    this.pos++;
    let digits = "";
    while (this.pos < b.length && b[this.pos] !== 62) {
      const c = b[this.pos++];
      if (!WS.has(c)) digits += String.fromCharCode(c);
    }
    this.pos++;
    if (digits.length % 2) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16) || 0;
    return out;
  }

  /** Prochain élément : valeur, opérateur ({ op }) ou fin de flux (undefined). */
  next(): { value: Operand } | { op: string } | { close: "]" | ">>" } | undefined {
    this.skipSpace();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 40) return { value: this.literal() };
    if (c === 60) {
      if (b[this.pos + 1] === 60) {
        this.pos += 2;
        return { value: this.dict() };
      }
      return { value: this.hex() };
    }
    if (c === 62 && b[this.pos + 1] === 62) {
      this.pos += 2;
      return { close: ">>" };
    }
    if (c === 91) {
      this.pos++;
      const arr: Operand[] = [];
      for (;;) {
        const t = this.next();
        if (!t || ("close" in t && t.close === "]")) break;
        if ("value" in t) arr.push(t.value);
        else if ("op" in t) arr.push(t.op); // mot-clé dans un tableau : conservé tel quel
      }
      return { value: arr };
    }
    if (c === 93) {
      this.pos++;
      return { close: "]" };
    }
    if (c === 47) {
      this.pos++;
      return { value: { name: this.regular() } };
    }
    if (c === 123 || c === 125 || c === 41 || c === 62) {
      this.pos++;
      return this.next();
    }
    const word = this.regular();
    if (NUMBER.test(word)) return { value: parseFloat(word) };
    if (word === "true" || word === "false") return { value: word === "true" };
    if (word === "null") return { value: null };
    return { op: word };
  }

  private dict(): Operand {
    const items: Operand[] = [];
    for (;;) {
      const t = this.next();
      if (!t || ("close" in t && t.close === ">>")) break;
      if ("value" in t) items.push(t.value);
    }
    return items;
  }

  /** Saute les données binaires d'une image en ligne (après ID, jusqu'à EI). */
  skipInlineImage() {
    const b = this.b;
    this.pos++; // espace unique après ID
    while (this.pos < b.length) {
      if (
        b[this.pos] === 69 &&
        b[this.pos + 1] === 73 &&
        WS.has(b[this.pos - 1]) &&
        (this.pos + 2 >= b.length || WS.has(b[this.pos + 2]) || DELIM.has(b[this.pos + 2]))
      ) {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
  }
}

function parseOps(bytes: Uint8Array): Op[] {
  const lex = new Lexer(bytes);
  const ops: Op[] = [];
  let args: Operand[] = [];
  let start = -1;
  for (;;) {
    const before = lex.pos;
    const t = lex.next();
    if (!t) break;
    if ("close" in t) continue;
    if ("value" in t) {
      if (start < 0) start = firstNonSpace(bytes, before);
      args.push(t.value);
      continue;
    }
    const opStart = start < 0 ? firstNonSpace(bytes, before) : start;
    if (t.op === "BI") {
      // Image en ligne : dictionnaire jusqu'à ID puis données binaires jusqu'à EI.
      for (;;) {
        const u = lex.next();
        if (!u || ("op" in u && u.op === "ID")) break;
      }
      lex.skipInlineImage();
    }
    ops.push({ op: t.op, args, start: opStart, end: lex.pos });
    args = [];
    start = -1;
  }
  return ops;
}

function firstNonSpace(b: Uint8Array, from: number): number {
  let i = from;
  for (;;) {
    while (i < b.length && WS.has(b[i])) i++;
    if (b[i] === 37) while (i < b.length && b[i] !== 10 && b[i] !== 13) i++;
    else return i;
  }
}

// ------------------------------------------------------------------ polices

interface FontMetrics {
  bytesPerCode: 1 | 2;
  /** Largeur en unités de texte pour 1 pt (déjà multipliée par la matrice de police). */
  width(code: number): number | undefined;
}

const STANDARD_ALIASES: Record<string, IFontNames> = {
  helvetica: "Helvetica",
  "helvetica-bold": "Helvetica-Bold",
  "helvetica-oblique": "Helvetica-Oblique",
  "helvetica-boldoblique": "Helvetica-BoldOblique",
  arial: "Helvetica",
  arialmt: "Helvetica",
  "arial-bold": "Helvetica-Bold",
  "arial-boldmt": "Helvetica-Bold",
  "arial-italic": "Helvetica-Oblique",
  "arial-italicmt": "Helvetica-Oblique",
  "arial-bolditalic": "Helvetica-BoldOblique",
  "arial-bolditalicmt": "Helvetica-BoldOblique",
  "times-roman": "Times-Roman",
  "times-bold": "Times-Bold",
  "times-italic": "Times-Italic",
  "times-bolditalic": "Times-BoldItalic",
  timesnewroman: "Times-Roman",
  timesnewromanps: "Times-Roman",
  timesnewromanpsmt: "Times-Roman",
  "timesnewroman-bold": "Times-Bold",
  "timesnewromanps-boldmt": "Times-Bold",
  "timesnewroman-italic": "Times-Italic",
  "timesnewromanps-italicmt": "Times-Italic",
  "timesnewroman-bolditalic": "Times-BoldItalic",
  "timesnewromanps-bolditalicmt": "Times-BoldItalic",
  courier: "Courier",
  "courier-bold": "Courier-Bold",
  "courier-oblique": "Courier-Oblique",
  "courier-boldoblique": "Courier-BoldOblique",
  couriernew: "Courier",
  couriernewpsmt: "Courier",
  symbol: "Symbol",
  zapfdingbats: "ZapfDingbats",
};

const codeTables = new Map<string, Map<number, string>>();
/** Table code → nom de glyphe d'un encodage (WinAnsi, Symbol, ZapfDingbats). */
function codeNames(which: "WinAnsi" | "Symbol" | "ZapfDingbats"): Map<number, string> {
  let table = codeTables.get(which);
  if (!table) {
    table = new Map();
    const enc = Encodings[which];
    for (const cp of enc.supportedCodePoints) {
      const { code, name } = enc.encodeUnicodeCodePoint(cp);
      if (!table.has(code)) table.set(code, name);
    }
    codeTables.set(which, table);
  }
  return table;
}

function num(o: PDFObject | undefined): number | undefined {
  return o instanceof PDFNumber ? o.asNumber() : undefined;
}

function nameOf(o: PDFObject | undefined): string | undefined {
  return o instanceof PDFName ? o.decodeText() : undefined;
}

/** Largeurs d'une police à partir de son dictionnaire ; undefined si non prise en charge. */
function fontMetrics(doc: PDFDocument, font: PDFDict): FontMetrics | undefined {
  const ctx = doc.context;
  const look = (d: PDFDict, key: string) => ctx.lookup(d.get(PDFName.of(key)));
  const subtype = nameOf(look(font, "Subtype"));

  if (subtype === "Type0") {
    const encoding = nameOf(look(font, "Encoding"));
    if (encoding !== "Identity-H" && encoding !== "Identity-V") return undefined;
    const descendants = look(font, "DescendantFonts");
    const cid = descendants instanceof PDFArray ? ctx.lookup(descendants.get(0)) : undefined;
    if (!(cid instanceof PDFDict)) return undefined;
    const dw = num(look(cid, "DW")) ?? 1000;
    const widths = new Map<number, number>();
    const w = look(cid, "W");
    if (w instanceof PDFArray) {
      const items = w.asArray().map((x) => ctx.lookup(x));
      for (let i = 0; i < items.length; ) {
        const first = num(items[i]);
        const next = items[i + 1];
        if (first === undefined) break;
        if (next instanceof PDFArray) {
          next.asArray().forEach((x, k) => widths.set(first + k, num(ctx.lookup(x)) ?? dw));
          i += 2;
        } else {
          const last = num(next);
          const value = num(items[i + 2]);
          if (last === undefined || value === undefined) break;
          for (let c = first; c <= last; c++) widths.set(c, value);
          i += 3;
        }
      }
    }
    return { bytesPerCode: 2, width: (code) => (widths.get(code) ?? dw) / 1000 };
  }

  // Polices simples (Type1, TrueType, Type3, MMType1) : un octet par caractère.
  let scale = 1 / 1000;
  if (subtype === "Type3") {
    const fm = look(font, "FontMatrix");
    const a = fm instanceof PDFArray ? num(ctx.lookup(fm.get(0))) : undefined;
    if (a === undefined) return undefined;
    scale = a;
  }
  const widths = look(font, "Widths");
  const firstChar = num(look(font, "FirstChar")) ?? 0;
  const descriptor = look(font, "FontDescriptor");
  const missing = descriptor instanceof PDFDict ? num(look(descriptor, "MissingWidth")) : undefined;
  if (widths instanceof PDFArray) {
    const list = widths.asArray().map((x) => num(ctx.lookup(x)));
    return {
      bytesPerCode: 1,
      width: (code) => {
        const v = list[code - firstChar] ?? missing;
        return v === undefined ? undefined : v * scale;
      },
    };
  }

  // Police standard sans tableau de largeurs : métriques AFM des 14 polices de base.
  const base = (nameOf(look(font, "BaseFont")) ?? "").replace(/^[A-Z]{6}\+/, "").toLowerCase().replace(/,/g, "-");
  const std = STANDARD_ALIASES[base] ?? STANDARD_ALIASES[base.replace(/[-\s]/g, "")];
  if (!std) return undefined;
  const afm = StandardFont.load(std);
  // Encodage de base : WinAnsi pour les polices latines (identique à l'encodage
  // standard pour les caractères ASCII), encodage propre pour Symbol et ZapfDingbats.
  const names = new Map<number, string>(codeNames(std === "Symbol" || std === "ZapfDingbats" ? std : "WinAnsi"));
  const enc = look(font, "Encoding");
  if (enc instanceof PDFDict) {
    const diff = look(enc, "Differences");
    if (diff instanceof PDFArray) {
      let code = 0;
      for (const x of diff.asArray().map((y) => ctx.lookup(y))) {
        const n = num(x);
        if (n !== undefined) code = n;
        else if (x instanceof PDFName) names.set(code++, x.decodeText());
      }
    }
  }
  return {
    bytesPerCode: 1,
    width: (code) => {
      const n = names.get(code);
      const v = n ? afm.getWidthOfGlyph(n) : undefined;
      return typeof v === "number" ? v / 1000 : missing !== undefined ? missing / 1000 : undefined;
    },
  };
}

// ------------------------------------------------------------------ écriture

function fmt(n: number): string {
  const s = n.toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

function hexString(bytes: number[]): string {
  return `<${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}>`;
}

/** Élément d'un TJ réécrit : octets d'un caractère gardé, ou décalage. */
type Piece = { keep: number[] } | { shift: number };

function serializeTJ(pieces: Piece[]): string {
  const out: string[] = [];
  let bytes: number[] = [];
  let shift = 0;
  const flushBytes = () => {
    if (bytes.length) out.push(hexString(bytes));
    bytes = [];
  };
  const flushShift = () => {
    if (Math.abs(shift) > 1e-6) out.push(fmt(shift));
    shift = 0;
  };
  for (const p of pieces) {
    if ("keep" in p) {
      flushShift();
      bytes.push(...p.keep);
    } else {
      flushBytes();
      shift += p.shift;
    }
  }
  flushBytes();
  flushShift();
  return `[${out.join(" ")}] TJ`;
}

// ------------------------------------------------------------------ traitement

interface GState {
  ctm: Matrix;
  font?: string;
  size: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  tr: number;
  rise: number;
}

function contentBytes(doc: PDFDocument, page: PDFPage): Uint8Array[] | undefined {
  const ctx = doc.context;
  const contents = page.node.get(PDFName.of("Contents"));
  const resolved = ctx.lookup(contents);
  const refs = resolved instanceof PDFArray ? resolved.asArray() : contents ? [contents] : [];
  const out: Uint8Array[] = [];
  for (const r of refs) {
    const s = ctx.lookup(r);
    if (!(s instanceof PDFRawStream)) return undefined;
    out.push(decodePDFRawStream(s).decode());
  }
  return out;
}

/**
 * Retire du contenu de la page les caractères situés dans les zones données
 * (espace utilisateur PDF). Renvoie, pour chaque zone, le nombre de caractères
 * retirés. Ne modifie la page que si au moins un caractère est retiré.
 */
export function removeTextInRects(doc: PDFDocument, page: PDFPage, lines: RemovalZone[]): RemovalResult[] {
  const results: RemovalResult[] = lines.map(() => ({ removed: 0, invisible: 0 }));
  if (!lines.length) return results;
  const parts = contentBytes(doc, page);
  if (!parts?.length) return results;

  // Les flux d'une page se lisent comme un seul flux concaténé.
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    bytes[offset + p.length] = 10;
    offset += p.length + 1;
  }

  const fontsDict = (() => {
    const res = page.node.Resources();
    const f = res ? doc.context.lookup(res.get(PDFName.of("Font"))) : undefined;
    return f instanceof PDFDict ? f : undefined;
  })();
  const metricsCache = new Map<string, FontMetrics | undefined>();
  const metricsFor = (name?: string) => {
    if (!name || !fontsDict) return undefined;
    if (!metricsCache.has(name)) {
      const f = doc.context.lookup(fontsDict.get(PDFName.of(name)));
      let m: FontMetrics | undefined;
      try {
        m = f instanceof PDFDict ? fontMetrics(doc, f) : undefined;
      } catch {
        m = undefined;
      }
      metricsCache.set(name, m);
    }
    return metricsCache.get(name);
  };

  // Repère local de chaque ligne : u le long de la ligne de base, n perpendiculaire.
  const frames = lines.map((l) => {
    if ("rect" in l) return { rect: l.rect };
    const rad = (l.angle * Math.PI) / 180;
    return { line: l, ux: Math.cos(rad), uy: Math.sin(rad) };
  });
  /**
   * Lignes auxquelles appartient un caractère : sa ligne de base doit être celle
   * de la ligne (à 0,35 corps près) et son milieu doit tomber dans la longueur de la ligne.
   */
  const onLines = (start: [number, number], end: [number, number], center: [number, number]) => {
    const hit: number[] = [];
    frames.forEach((f, i) => {
      if (f.rect) {
        // Cache blanc : le caractère part si son centre est sous le cache.
        const [x1, y1, x2, y2] = f.rect;
        if (center[0] >= x1 && center[0] <= x2 && center[1] >= y1 && center[1] <= y2) hit.push(i);
        return;
      }
      const l = f.line!;
      const dx = (start[0] + end[0]) / 2 - l.origin[0];
      const dy = (start[1] + end[1]) / 2 - l.origin[1];
      const along = dx * f.ux! + dy * f.uy!;
      const across = -dx * f.uy! + dy * f.ux!;
      const tol = l.fontSize * 0.35;
      const slack = Math.min(l.fontSize * 0.15, 1);
      if (Math.abs(across) <= tol && along >= -slack && along <= l.width + slack) hit.push(i);
    });
    return hit;
  };

  const ops = parseOps(bytes);
  const replacements: { start: number; end: number; text: string }[] = [];
  let gs: GState = { ctm: IDENTITY, size: 0, tc: 0, tw: 0, th: 1, tl: 0, tr: 0, rise: 0 };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  /** Position perdue (police non prise en charge) jusqu'au prochain positionnement de ligne. */
  let lost = false;

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
    tm = tlm;
    lost = false;
  };

  /** Parcourt les caractères d'une chaîne ; renvoie les pièces réécrites ou undefined si rien n'est retiré. */
  const show = (items: Operand[]): Piece[] | undefined | "skip" => {
    if (lost) return undefined;
    const metrics = metricsFor(gs.font);
    const pieces: Piece[] = [];
    let touched = false;
    for (const item of items) {
      if (typeof item === "number") {
        tm = mul([1, 0, 0, 1, (-item / 1000) * gs.size * gs.th, 0], tm);
        pieces.push({ shift: item });
        continue;
      }
      if (!(item instanceof Uint8Array)) continue;
      if (!metrics) {
        // Police non prise en charge : impossible de suivre les positions de façon sûre.
        return "skip";
      }
      const step = metrics.bytesPerCode;
      for (let i = 0; i + step <= item.length; i += step) {
        const code = step === 2 ? (item[i] << 8) | item[i + 1] : item[i];
        const w0 = metrics.width(code);
        if (w0 === undefined) return "skip";
        const space = step === 1 && code === 32 ? gs.tw : 0;
        const tx = (w0 * gs.size + gs.tc + space) * gs.th;
        const trm = mul(tm, gs.ctm);
        const adv = w0 * gs.size * gs.th;
        const hit = gs.size
          ? onLines(apply(trm, 0, gs.rise), apply(trm, adv, gs.rise), apply(trm, adv / 2, gs.rise + gs.size * 0.35))
          : [];
        const glyph = Array.from(item.subarray(i, i + step));
        if (hit.length) {
          touched = true;
          const invisible = gs.tr === 3 || gs.tr === 7;
          for (const h of hit) results[h][invisible ? "invisible" : "removed"]++;
          // Décalage TJ équivalent à l'avance du caractère retiré.
          pieces.push({ shift: (-tx * 1000) / (gs.size * gs.th) });
        } else {
          pieces.push({ keep: glyph });
        }
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
    }
    return touched ? pieces : undefined;
  };

  for (const o of ops) {
    const a = o.args;
    const n = (i: number) => (typeof a[i] === "number" ? (a[i] as number) : 0);
    switch (o.op) {
      case "q":
        stack.push({ ...gs });
        break;
      case "Q":
        gs = stack.pop() ?? gs;
        break;
      case "cm":
        gs.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        lost = false;
        break;
      case "Tc":
        gs.tc = n(0);
        break;
      case "Tw":
        gs.tw = n(0);
        break;
      case "Tz":
        gs.th = n(0) / 100;
        break;
      case "TL":
        gs.tl = n(0);
        break;
      case "Tr":
        gs.tr = n(0);
        break;
      case "Ts":
        gs.rise = n(0);
        break;
      case "Tf": {
        const f = a[0];
        gs.font = f && typeof f === "object" && "name" in f ? f.name : undefined;
        gs.size = n(1);
        break;
      }
      case "Td":
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = tlm;
        lost = false;
        break;
      case "TD":
        gs.tl = -n(1);
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = tlm;
        lost = false;
        break;
      case "Tm":
        tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        tm = tlm;
        lost = false;
        break;
      case "T*":
        nextLine();
        break;
      case "Tj":
      case "TJ":
      case "'":
      case '"': {
        let prefix = "";
        if (o.op === '"') {
          gs.tw = n(0);
          gs.tc = n(1);
          prefix = `${fmt(n(0))} Tw ${fmt(n(1))} Tc `;
        }
        if (o.op === "'" || o.op === '"') {
          nextLine();
          prefix += "T* ";
        }
        const last = a[a.length - 1];
        const items: Operand[] = o.op === "TJ" ? (Array.isArray(last) ? last : []) : [last];
        const pieces = show(items);
        if (pieces === "skip") {
          lost = true;
          break;
        }
        if (pieces) replacements.push({ start: o.start, end: o.end, text: prefix + serializeTJ(pieces) });
        break;
      }
    }
  }

  if (!replacements.length) return results;

  // Réécriture : seuls les opérateurs touchés changent, le reste du flux est recopié tel quel.
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let at = 0;
  for (const r of replacements.sort((x, y) => x.start - y.start)) {
    chunks.push(bytes.subarray(at, r.start), enc.encode(r.text));
    at = r.end;
  }
  chunks.push(bytes.subarray(at));
  const size = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  const stream = doc.context.flateStream(out);
  const ref: PDFRef = doc.context.register(stream);
  page.node.set(PDFName.of("Contents"), doc.context.obj([ref]));
  return results;
}
