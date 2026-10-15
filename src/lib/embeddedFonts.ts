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
  beginText,
  decodePDFRawStream,
  endText,
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
 * Caractères du texte absents de la police incorporée. Les retours à la ligne
 * et les espaces sont toujours possibles (les mots sont alors positionnés).
 */
export function missingChars(font: EmbeddedFont, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text.replace(/\r?\n/g, "")) if (ch !== " " && !font.glyphs[ch]) missing.add(ch);
  return [...missing];
}

/** Le texte peut-il être écrit entièrement avec la police incorporée ? */
export function usesEmbedded(a: TextAnnotation): a is TextAnnotation & { embedded: EmbeddedFont } {
  return !!a.embedded && missingChars(a.embedded, a.text).length === 0;
}

/** Texte à afficher à l'écran avec la police incorporée (caractères internes de pdf.js). */
export function displayText(font: EmbeddedFont, line: string): string {
  return [...line].map((ch) => font.glyphs[ch]?.display ?? ch).join("");
}

function hexCodes(font: EmbeddedFont, line: string): string {
  return [...line]
    .map((ch) => font.glyphs[ch].code.toString(16).padStart(font.codeBytes * 2, "0"))
    .join("");
}

let resourceCounter = 0;

/**
 * Écrit le texte dans la page avec la ressource de police d'origine.
 * Retourne false si la police n'est pas retrouvée (l'appelant se replie alors
 * sur la police de remplacement).
 */
export function drawEmbeddedText(doc: PDFDocument, page: PDFPage, a: TextAnnotation & { embedded: EmbeddedFont }): boolean {
  const info = findFontDict(doc, a.embedded.baseFont);
  if (!info) return false;
  page.node.normalize();
  const fontKey = page.node.newFontDictionaryKey(`PaE${++resourceCounter}`);
  page.node.setFontDictionary(fontKey, info.ref);
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
  ops.push(beginText(), setFillingColor(rgb(r, g, b)), setFontAndSize(fontKey, a.fontSize));
  const font = a.embedded;
  const right: [number, number] = [cos, sin];
  const em = a.fontSize / 1000;
  const lineWidth = (line: string) =>
    [...line].reduce((w, ch) => w + (ch === " " && !font.glyphs[" "] ? font.spaceWidth : (font.glyphs[ch]?.width ?? 500)), 0) * em;
  const underlines: [[number, number], [number, number]][] = [];
  a.text.split(/\r?\n/).forEach((line, i) => {
    if (!line) return;
    const start = addScaled(a.origin, down, a.fontSize * 1.25 * i);
    if (a.underline) {
      const base = addScaled(start, down, a.fontSize * 0.12);
      underlines.push([base, addScaled(base, right, lineWidth(line))]);
    }
    if (font.glyphs[" "]) {
      ops.push(setTextMatrix(cos, sin, -sin, cos, start[0], start[1]), showText(PDFHexString.of(hexCodes(font, line))));
      return;
    }
    // Pas de glyphe espace dans la police : chaque mot est placé à sa position.
    let advance = 0;
    for (const word of line.split(" ")) {
      if (word) {
        const [x, y] = addScaled(start, right, advance * em);
        ops.push(setTextMatrix(cos, sin, -sin, cos, x, y), showText(PDFHexString.of(hexCodes(font, word))));
      }
      advance += [...word].reduce((w, ch) => w + (font.glyphs[ch]?.width ?? 500), 0) + font.spaceWidth;
    }
  });
  ops.push(endText());
  if (underlines.length) {
    ops.push(setStrokingColor(rgb(r, g, b)), setLineWidth(Math.max(0.5, a.fontSize * 0.07)));
    for (const [s, e] of underlines) ops.push(moveTo(s[0], s[1]), lineTo(e[0], e[1]), stroke());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
  return true;
}
