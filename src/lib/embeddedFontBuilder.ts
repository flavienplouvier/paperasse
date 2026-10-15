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

/** Famille CSS unique par police incorporée, enregistrée une seule fois. */
async function registerFace(baseFont: string, data: Uint8Array): Promise<string> {
  let family = registered.get(baseFont);
  if (family) return family;
  family = `fl-emb-${registered.size + 1}-${baseFont.replace(/[^a-zA-Z0-9]/g, "")}`;
  const face = new FontFace(family, data.slice());
  await face.load();
  document.fonts.add(face);
  registered.set(baseFont, family);
  return family;
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
  if (!font?.name || !font.data || !font.toFontChar || font.isType3Font || font.missingFile) return null;

  let doc: PDFDocument;
  try {
    doc = await loadDoc(bytes);
  } catch {
    return null;
  }
  const info = findFontDict(doc, font.name);
  const codes = info && fontCodeMap(info);
  if (!codes) return null;

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
