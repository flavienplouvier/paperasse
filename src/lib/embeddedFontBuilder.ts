import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import type { PDFPageProxy } from "./pdfjs";
import { findFontDict, fontCodeMap, type EmbeddedFont } from "./embeddedFonts";

interface PdfjsFont {
  name?: string;
  data?: Uint8Array;
  isType3Font?: boolean;
  missingFile?: boolean;
  /** pdf.js 6 : Map code → caractère d'affichage (tableau/objet dans les versions antérieures). */
  toFontChar?: Map<number, number> | Record<number, number> | number[];
  /** Largeurs par code, en millièmes de corps. */
  widths?: Map<number, number> | Record<number, number> | number[];
  defaultWidth?: number;
  /** Police non incorporée : police système utilisée par pdf.js pour l'afficher. */
  systemFontInfo?: { css?: string; loadedName?: string } | null;
}

/** Famille CSS de repli pour une police standard PDF non incorporée. */
function standardCss(name: string): string {
  const n = name.toLowerCase();
  if (/courier|mono/.test(n)) return `"Courier New", Courier, "Liberation Mono", monospace`;
  if (/times|serif|roman/.test(n) && !/sans/.test(n)) return `"Times New Roman", Times, "Liberation Serif", serif`;
  return `Helvetica, Arial, "Liberation Sans", sans-serif`;
}

const lookup = (table: PdfjsFont["toFontChar"], code: number): number | undefined =>
  table instanceof Map ? table.get(code) : (table as Record<number, number> | undefined)?.[code];

const docs = new WeakMap<Uint8Array, Promise<PDFDocument>>();
const registered = new Map<string, string>();

function loadDoc(bytes: Uint8Array): Promise<PDFDocument> {
  let p = docs.get(bytes);
  if (!p) {
    p = PDFDocument.load(bytes, { updateMetadata: false });
    docs.set(bytes, p);
  }
  return p;
}

/** Données de chaque police d'aperçu enregistrée (pour la sauvegarde automatique). */
const faceData = new Map<string, Uint8Array>();

async function addFace(family: string, data: Uint8Array) {
  const face = new FontFace(family, data.slice());
  await face.load();
  document.fonts.add(face);
  faceData.set(family, data);
}

/** Famille CSS unique par police incorporée, enregistrée une seule fois. */
async function registerFace(baseFont: string, data: Uint8Array): Promise<string> {
  let family = registered.get(baseFont);
  if (family) return family;
  family = `fl-emb-${Date.now().toString(36)}-${registered.size + 1}-${baseFont.replace(/[^a-zA-Z0-9]/g, "")}`;
  await addFace(family, data);
  registered.set(baseFont, family);
  return family;
}

/** Données des polices d'aperçu demandées (familles CSS sans guillemets). */
export function facesFor(families: Iterable<string>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const f of families) {
    const data = faceData.get(f);
    if (data) out[f] = data;
  }
  return out;
}

/** Réenregistre les polices d'aperçu d'un travail repris. */
export async function restoreFaces(faces: Record<string, Uint8Array>): Promise<void> {
  await Promise.all(
    Object.entries(faces).map(([family, data]) => (faceData.has(family) ? undefined : addFace(family, data).catch(() => undefined))),
  );
}

/**
 * Prépare la réutilisation de la police incorporée d'un fragment de texte :
 * liste des caractères disponibles (glyphe réellement présent et non vide
 * dans le sous-ensemble incorporé), codes PDF correspondants et aperçu.
 * Retourne null si la police ne peut pas être réutilisée (police Type 3,
 * police non incorporée, PDF chiffré, encodage non pris en charge…).
 */
export async function buildEmbeddedFont(
  bytes: Uint8Array,
  page: PDFPageProxy,
  loadedName: string,
): Promise<EmbeddedFont | null> {
  let font: PdfjsFont | undefined;
  try {
    font = page.commonObjs.get(loadedName) as PdfjsFont;
  } catch {
    return null;
  }
  if (!font?.name || font.isType3Font) return null;
  if (!font.missingFile && (!font.data || !font.toFontChar)) return null;

  let doc: PDFDocument;
  try {
    doc = await loadDoc(bytes);
  } catch {
    return null;
  }
  const info = findFontDict(doc, font.name);
  const codes = info && fontCodeMap(info);
  if (!codes) return null;

  if (font.missingFile) {
    // Police non incorporée (ex. les polices standard Courier, Times, Helvetica) :
    // on réutilise la ressource de police d'origine du PDF à l'enregistrement, et à
    // l'écran la même police système que pdf.js — le texte modifié reste identique.
    const glyphs: EmbeddedFont["glyphs"] = {};
    for (const [code, text] of codes.map) {
      if ([...text].length !== 1 || glyphs[text]) continue;
      glyphs[text] = { code, display: text, width: lookup(font.widths, code) ?? font.defaultWidth };
    }
    if (!Object.keys(glyphs).length) return null;
    const sys = font.systemFontInfo;
    const fallback = sys?.css || standardCss(font.name);
    return {
      baseFont: font.name,
      cssFamily: sys?.loadedName ? `"${sys.loadedName}", ${fallback}` : fallback,
      codeBytes: codes.codeBytes,
      glyphs,
      spaceWidth: glyphs[" "]?.width ?? 278,
      notEmbedded: true,
    };
  }
  if (!font.data) return null;

  let program: ReturnType<typeof fontkit.create> | null = null;
  try {
    program = fontkit.create(font.data);
  } catch {
    program = null;
  }

  const glyphs: EmbeddedFont["glyphs"] = {};
  for (const [code, text] of codes.map) {
    const chars = [...text];
    if (chars.length !== 1 || glyphs[text]) continue;
    const fontChar = lookup(font.toFontChar, code);
    if (fontChar === undefined) continue;
    if (program) {
      const glyph = program.glyphForCodePoint(fontChar);
      if (!glyph || glyph.id === 0) continue;
      // Les sous-ensembles gardent parfois des glyphes vides pour les caractères non utilisés.
      const commands = (glyph.path as unknown as { commands?: unknown[] } | undefined)?.commands;
      if (!/\s/.test(text) && !commands?.length) continue;
    }
    const width = lookup(font.widths, code) ?? font.defaultWidth;
    glyphs[text] = { code, display: String.fromCodePoint(fontChar), width };
  }
  if (!Object.keys(glyphs).length) return null;

  const family = await registerFace(font.name, font.data);
  return {
    baseFont: font.name,
    cssFamily: `"${family}"`,
    codeBytes: codes.codeBytes,
    glyphs,
    // Espace typique d'une police latine (Arial, Helvetica : 278/1000).
    spaceWidth: glyphs[" "]?.width ?? 278,
  };
}
