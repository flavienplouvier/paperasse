import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFPage,
  PDFRawStream,
  PDFRef,
  type PDFFont,
  beginText,
  decodePDFRawStream,
  endText,
  closePath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  setLineWidth,
  setStrokingColor,
  stroke,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setTextMatrix,
  showText,
} from "pdf-lib";
import type { TextAnnotation } from "./types";
import { addScaled, screenAxes } from "./geometry";
import { t } from "../i18n";

/**
 * Réutilisation de la police incorporée dans le PDF (comme Acrobat) pour
 * modifier un texte sans changer d'apparence.
 *
 * Les PDF n'incorporent en général qu'un sous-ensemble de la police : seuls
 * les caractères présents dans ce sous-ensemble sont utilisables. Pour chacun,
 * on retient le code à écrire dans le PDF et le caractère à afficher à l'écran
 * avec la police chargée par pdf.js.
 */
export interface EmbeddedFont {
  /** Nom de la police dans le PDF, ex. « ABCDEF+Calibri-Bold ». */
  baseFont: string;
  /** Famille CSS de l'aperçu (données de police fournies par pdf.js). */
  cssFamily: string;
  /** Octets par code : 1 (police simple) ou 2 (police composite Identity-H). */
  codeBytes: 1 | 2;
  /** Caractère Unicode → code PDF, caractère d'affichage et largeur (millièmes de corps). */
  glyphs: Record<string, { code: number; display: string; width?: number }>;
  /**
   * Largeur d'une espace (millièmes de corps). Beaucoup de PDF n'incorporent
   * pas le glyphe espace et positionnent les mots : on fait de même.
   */
  spaceWidth: number;
  /** Police d'origine non incorporée dans le fichier (police standard PDF). */
  notEmbedded?: boolean;
  /**
   * Autres sous-ensembles de la même police dans le PDF : ils apportent les vrais
   * glyphes de caractères absents du sous-ensemble principal (ex. un « P »).
   */
  alternates?: AlternateFont[];
}

/** Sous-ensemble complémentaire de la même police (même dessin, autres caractères). */
export interface AlternateFont {
  baseFont: string;
  glyphs: Record<string, { code: number; width?: number }>;
}

// ---------------------------------------------------------------------------
// Lecture des tables ToUnicode

/** Analyse une CMap ToUnicode (bfchar / bfrange) : code → texte Unicode. */
export function parseToUnicode(cmap: string): { map: Map<number, string>; codeBytes: number } {
  const map = new Map<number, string>();
  let codeBytes = 1;
  const hexToText = (hex: string) => {
    const units: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length === 2) units.push(parseInt(hex, 16));
    return String.fromCharCode(...units);
  };
  const space = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap);
  if (space) {
    const first = /<([0-9a-fA-F]+)>/.exec(space[1]);
    if (first) codeBytes = first[1].length / 2;
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      codeBytes = Math.max(codeBytes, m[1].length / 2);
      map.set(parseInt(m[1], 16), hexToText(m[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      codeBytes = Math.max(codeBytes, m[1].length / 2);
      if (m[3].startsWith("[")) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        items.forEach((hex, i) => lo + i <= hi && map.set(lo + i, hexToText(hex)));
      } else {
        const start = m[3].slice(1, -1);
        // Le dernier code UTF-16 s'incrémente sur la plage.
        const prefix = start.slice(0, -4);
        const last = parseInt(start.slice(-4), 16);
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          map.set(c, hexToText(prefix + (last + c - lo).toString(16).padStart(4, "0")));
        }
      }
    }
  }
  return { map, codeBytes };
}

// ---------------------------------------------------------------------------
// Recherche de la police dans le document

const name = (o: unknown) => (o instanceof PDFName ? o.decodeText() : undefined);
const cleanName = (n: string) => n.replace(/-Identity-[HV]$/, "");
const USABLE = new Set(["Type0", "TrueType", "Type1", "MMType1"]);

export interface FontDictInfo {
  ref: PDFRef;
  dict: PDFDict;
  subtype: string;
}

const withoutSubsetTag = (n: string) => n.replace(/^[A-Z]{6}\+/, "");

/**
 * Trouve le dictionnaire de police (utilisable comme ressource) portant ce nom.
 * Correspondance exacte d'abord (un PDF peut contenir plusieurs sous-ensembles
 * de la même police), puis sans le préfixe de sous-ensemble si elle est unique.
 */
export function findFontDict(doc: PDFDocument, baseFont: string): FontDictInfo | null {
  const wanted = cleanName(baseFont);
  const fonts = fontDicts(doc);
  const exact = fonts.find((f) => f.names.includes(wanted));
  if (exact) return exact.info;
  const loose = fonts.filter((f) => f.names.some((n) => withoutSubsetTag(n) === withoutSubsetTag(wanted)));
  return loose.length === 1 ? loose[0].info : null;
}

function fontDicts(doc: PDFDocument): { info: FontDictInfo; names: string[] }[] {
  const out: { info: FontDictInfo; names: string[] }[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || name(obj.get(PDFName.of("Type"))) !== "Font") continue;
    const subtype = name(obj.get(PDFName.of("Subtype"))) ?? "";
    if (!USABLE.has(subtype)) continue;
    const names = [name(obj.get(PDFName.of("BaseFont")))];
    const descendants = obj.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
    const desc = descendants?.lookupMaybe(0, PDFDict);
    if (desc) {
      names.push(name(desc.get(PDFName.of("BaseFont"))));
      names.push(name(desc.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict)?.get(PDFName.of("FontName"))));
    } else {
      names.push(name(obj.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict)?.get(PDFName.of("FontName"))));
    }
    out.push({ info: { ref, dict: obj, subtype }, names: names.filter((n): n is string => !!n).map(cleanName) });
  }
  return out;
}

/**
 * Correspondance code PDF → Unicode d'une police du document : sa table
 * ToUnicode, ou à défaut l'encodage WinAnsi d'une police simple.
 */
export function fontCodeMap(info: FontDictInfo): { map: Map<number, string>; codeBytes: 1 | 2 } | null {
  const stream = info.dict.lookup(PDFName.of("ToUnicode"));
  if (stream instanceof PDFRawStream) {
    const text = new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    const { map, codeBytes } = parseToUnicode(text);
    if (info.subtype !== "Type0") {
      // Police simple : toujours 1 octet par caractère, même si sa table ToUnicode
      // déclare des codes sur 2 octets (fréquent, ex. <0000> <FFFF>). Écrire 2 octets
      // ferait lire un caractère nul (petit carré) devant chaque lettre.
      const simple = new Map([...map].filter(([code]) => code <= 0xff));
      return { map: simple, codeBytes: 1 };
    }
    if (codeBytes !== 1 && codeBytes !== 2) return null;
    return { map, codeBytes };
  }
  if (info.subtype === "Type0") return null;
  // Police simple sans ToUnicode : encodage WinAnsi, hors codes redéfinis par /Differences.
  // /Encoding peut être un nom (/WinAnsiEncoding) ou un dictionnaire (avec /Differences).
  const enc = info.dict.get(PDFName.of("Encoding"));
  const encObj = info.dict.lookup(PDFName.of("Encoding"));
  const encDict = encObj instanceof PDFDict ? encObj : undefined;
  const base = name(enc) ?? name(encDict?.get(PDFName.of("BaseEncoding"))) ?? "WinAnsiEncoding";
  if (base !== "WinAnsiEncoding" && base !== "StandardEncoding") return null;
  const redefined = new Set<number>();
  const diffs = encDict?.lookupMaybe(PDFName.of("Differences"), PDFArray);
  if (diffs) {
    let code = 0;
    for (let i = 0; i < diffs.size(); i++) {
      const item = diffs.get(i);
      if (item instanceof PDFNumber) code = item.asNumber();
      else redefined.add(code++);
    }
  }
  const decoder = new TextDecoder("windows-1252");
  const map = new Map<number, string>();
  for (let c = 32; c < 256; c++) {
    if (!redefined.has(c) && (base === "WinAnsiEncoding" || c < 127)) map.set(c, decoder.decode(new Uint8Array([c])));
  }
  return { map, codeBytes: 1 };
}

// ---------------------------------------------------------------------------
// Utilisation pour un texte

/**
 * Source d'un caractère : -1 = sous-ensemble principal, n ≥ 0 = sous-ensemble
 * complémentaire n, "fallback" = police de remplacement (glyphe absent du PDF).
 */
export type GlyphSource = number | "fallback";

export function sourceOf(font: EmbeddedFont, ch: string): GlyphSource {
  if (font.glyphs[ch]) return -1;
  const i = font.alternates?.findIndex((alt) => alt.glyphs[ch]) ?? -1;
  return i >= 0 ? i : "fallback";
}

/** Caractères absents de toute la police d'origine du PDF (écrits avec la police de remplacement). */
export function missingChars(font: EmbeddedFont, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text.replace(/\r?\n/g, "")) if (ch !== " " && sourceOf(font, ch) === "fallback") missing.add(ch);
  return [...missing];
}

/** Caractères pris dans un autre sous-ensemble de la même police (vrai glyphe d'origine). */
export function borrowedChars(font: EmbeddedFont, text: string): string[] {
  const out = new Set<string>();
  for (const ch of text.replace(/\r?\n/g, "")) if (ch !== " " && typeof sourceOf(font, ch) === "number" && sourceOf(font, ch) !== -1) out.add(ch);
  return [...out];
}

/** Le texte peut-il être écrit entièrement avec la police d'origine du PDF ? */
export function usesEmbedded(a: TextAnnotation): a is TextAnnotation & { embedded: EmbeddedFont } {
  return !!a.embedded && missingChars(a.embedded, a.text).length === 0;
}

/**
 * Découpe une ligne en segments de même source. Les espaces suivent le segment
 * en cours (ou le principal) ; si la police principale n'a pas de glyphe espace,
 * ils forment des segments « space » qui ne font qu'avancer.
 */
export function segmentLine(font: EmbeddedFont, line: string): { source: GlyphSource | "space"; text: string }[] {
  const out: { source: GlyphSource | "space"; text: string }[] = [];
  for (const ch of line) {
    let src: GlyphSource | "space";
    if (ch === " ") src = font.glyphs[" "] ? -1 : "space";
    else src = sourceOf(font, ch);
    const last = out[out.length - 1];
    if (last && last.source === src) last.text += ch;
    else out.push({ source: src, text: ch });
  }
  return out;
}

/**
 * Largeur d'un texte écrit avec la police d'origine (mêmes règles que
 * `drawEmbeddedText`) ; `fallback` mesure les caractères absents de toute la police.
 */
export function embeddedTextWidth(font: EmbeddedFont, text: string, size: number, fallback: (s: string) => number): number {
  let w = 0;
  for (const seg of segmentLine(font, text)) {
    if (seg.source === "space") w += [...seg.text].length * font.spaceWidth;
    else if (seg.source === "fallback") w += (fallback(seg.text) * 1000) / size;
    else {
      const glyphs = seg.source === -1 ? font.glyphs : font.alternates![seg.source].glyphs;
      for (const ch of seg.text) w += glyphs[ch]?.width ?? (ch === " " ? font.spaceWidth : 500);
    }
  }
  return (w * size) / 1000;
}

/** Texte à afficher à l'écran avec la police incorporée (caractères internes de pdf.js). */
export function displayText(font: EmbeddedFont, line: string): string {
  return [...line].map((ch) => font.glyphs[ch]?.display ?? ch).join("");
}

function hexCodes(glyphs: Record<string, { code: number }>, text: string, codeBytes: 1 | 2): string {
  return [...text].map((ch) => glyphs[ch].code.toString(16).padStart(codeBytes * 2, "0")).join("");
}

let resourceCounter = 0;

/**
 * Écrit le texte dans la page avec la police d'origine du PDF, caractère par
 * caractère : sous-ensemble principal, puis autres sous-ensembles de la même
 * police, puis — seulement pour les caractères absents de tout le PDF — la police
 * de remplacement. Chaque segment est placé à sa position exacte.
 * Retourne false si la police d'origine n'est pas retrouvée (l'appelant écrit
 * alors tout le texte avec la police de remplacement).
 */
export async function drawEmbeddedText(
  doc: PDFDocument,
  page: PDFPage,
  a: TextAnnotation & { embedded: EmbeddedFont },
  fallback?: () => Promise<PDFFont>,
): Promise<boolean> {
  const font = a.embedded;
  const info = findFontDict(doc, font.baseFont);
  if (!info) return false;
  page.node.normalize();

  // Ressource et octets par code de chaque source utilisée.
  type Res = { key: PDFName; codeBytes: 1 | 2; glyphs: Record<string, { code: number; width?: number }> };
  const resources = new Map<GlyphSource, Res | null>();
  const resourceFor = (src: number): Res | null => {
    if (resources.has(src)) return resources.get(src)!;
    const base = src === -1 ? font.baseFont : font.alternates![src].baseFont;
    const found = src === -1 ? info : findFontDict(doc, base);
    let res: Res | null = null;
    if (found) {
      const codeBytes: 1 | 2 = found.subtype === "Type0" ? 2 : 1;
      const glyphs = src === -1 ? font.glyphs : font.alternates![src].glyphs;
      const key = page.node.newFontDictionaryKey(`PaE${++resourceCounter}`);
      page.node.setFontDictionary(key, found.ref);
      res = { key, codeBytes, glyphs };
    }
    resources.set(src, res);
    return res;
  };

  // Police de remplacement chargée seulement si un caractère en a besoin.
  let fb: { font: PDFFont; key: PDFName } | null = null;
  const fallbackFont = async () => {
    if (!fb) {
      if (!fallback) throw new Error(t("Caractère absent de la police d'origine et aucune police de remplacement."));
      const f = await fallback();
      fb = { font: f, key: page.node.newFontDictionary(`PaF${++resourceCounter}`, f.ref) };
    }
    return fb;
  };

  const em = a.fontSize / 1000;
  const lines = a.text.split(/\r?\n/);
  // Préparation : segments de chaque ligne, sources indisponibles basculées sur le remplacement.
  const prepared: { source: GlyphSource | "space"; text: string; res?: Res }[][] = [];
  for (const line of lines) {
    const segs: { source: GlyphSource | "space"; text: string; res?: Res }[] = [];
    for (const seg of segmentLine(font, line)) {
      if (typeof seg.source === "number") {
        const res = resourceFor(seg.source);
        if (res && [...seg.text].every((ch) => ch === " " || res.codeBytes === 2 || (res.glyphs[ch]?.code ?? 0) <= 0xff)) {
          segs.push({ ...seg, res });
          continue;
        }
        segs.push({ source: "fallback", text: seg.text });
      } else segs.push(seg);
    }
    prepared.push(segs);
  }
  const advance = async (seg: { source: GlyphSource | "space"; text: string; res?: Res }) => {
    if (seg.source === "space") return [...seg.text].length * font.spaceWidth * em;
    if (seg.source === "fallback") return (await fallbackFont()).font.widthOfTextAtSize(seg.text, a.fontSize);
    return [...seg.text].reduce((w, ch) => w + (seg.res!.glyphs[ch]?.width ?? (ch === " " ? font.spaceWidth : 500)), 0) * em;
  };

  const ops = [pushGraphicsState()];
  if (a.opacity < 1) {
    const gs = doc.context.obj({ Type: "ExtGState", ca: a.opacity, CA: a.opacity });
    ops.push(setGraphicsState(page.node.newExtGState("PaGS", gs)));
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.color.slice(i, i + 2), 16) / 255);
  const rad = (a.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { down } = screenAxes(a.rotation);
  const right: [number, number] = [cos, sin];
  const textStart = ops.length;
  ops.push(beginText(), setFillingColor(rgb(r, g, b)));
  const underlines: [[number, number], [number, number]][] = [];
  const backgrounds: [number, number][][] = [];
  for (const [i, segs] of prepared.entries()) {
    if (!segs.length) continue;
    const start = addScaled(a.origin, down, a.fontSize * 1.25 * i);
    let x = 0;
    for (const seg of segs) {
      const w = await advance(seg);
      if (seg.source !== "space") {
        const [px, py] = addScaled(start, right, x);
        ops.push(setTextMatrix(cos, sin, -sin, cos, px, py));
        if (seg.source === "fallback") {
          const f = await fallbackFont();
          let encoded;
          try {
            encoded = f.font.encodeText(seg.text);
          } catch {
            throw new Error(
              t("La police de remplacement ne contient pas certains caractères de « {text} ». Choisissez une police qui les couvre.", { text: seg.text }),
            );
          }
          ops.push(setFontAndSize(f.key, a.fontSize), showText(encoded));
        } else {
          ops.push(setFontAndSize(seg.res!.key, a.fontSize), showText(PDFHexString.of(hexCodes(seg.res!.glyphs, seg.text, seg.res!.codeBytes))));
        }
      }
      x += w;
    }
    if (a.underline) {
      const base = addScaled(start, down, a.fontSize * 0.12);
      underlines.push([base, addScaled(base, right, x)]);
    }
    if (a.strike) {
      const base = addScaled(start, down, -a.fontSize * 0.3);
      underlines.push([base, addScaled(base, right, x)]);
    }
    if (a.highlight && x > 0) {
      // Fond de la ligne : coins dans le repère tourné du texte.
      const p0 = addScaled(addScaled(start, down, a.fontSize * 0.26), right, -a.fontSize * 0.06);
      const p1 = addScaled(p0, right, x + a.fontSize * 0.12);
      const p2 = addScaled(p1, down, -a.fontSize * 1.12);
      const p3 = addScaled(p0, down, -a.fontSize * 1.12);
      backgrounds.push([p0, p1, p2, p3]);
    }
  }
  ops.push(endText());
  if (backgrounds.length) {
    // Fonds dessinés avant le texte, en mode « produit » (le contenu de la page reste lisible).
    const gs = doc.context.obj({ Type: "ExtGState", BM: "Multiply", ca: a.opacity });
    const [hr, hg, hb] = [1, 3, 5].map((i) => parseInt(a.highlight!.slice(i, i + 2), 16) / 255);
    const bg = [pushGraphicsState(), setGraphicsState(page.node.newExtGState("PaHL", gs)), setFillingColor(rgb(hr, hg, hb))];
    for (const [p0, p1, p2, p3] of backgrounds) bg.push(moveTo(p0[0], p0[1]), lineTo(p1[0], p1[1]), lineTo(p2[0], p2[1]), lineTo(p3[0], p3[1]), closePath(), fill());
    bg.push(popGraphicsState());
    ops.splice(textStart, 0, ...bg);
  }
  if (underlines.length) {
    ops.push(setStrokingColor(rgb(r, g, b)), setLineWidth(Math.max(0.5, a.fontSize * 0.07)));
    for (const [s0, e] of underlines) ops.push(moveTo(s0[0], s0[1]), lineTo(e[0], e[1]), stroke());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
  return true;
}
