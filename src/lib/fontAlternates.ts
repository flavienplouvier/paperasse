import fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream, type PDFDocument } from "pdf-lib";
import { fontCodeMap, type AlternateFont, type FontDictInfo } from "./embeddedFonts";
import { fontMetrics } from "./removeText";

/**
 * Un PDF n'incorpore que les caractères utilisés de chaque police, parfois en
 * plusieurs sous-ensembles (un par page, un simple et un composite…). Un
 * caractère absent du sous-ensemble d'un texte (un « P ») existe souvent dans un
 * autre sous-ensemble de la même police : c'est le vrai glyphe, au même dessin.
 *
 * Seules les polices TrueType (FontFile2) sont examinées : leur programme dit
 * de façon sûre si un glyphe existe et n'est pas vide.
 */

const nameOf = (o: unknown) => (o instanceof PDFName ? o.decodeText() : undefined);
const baseName = (n: string) => n.replace(/^[A-Z]{6}\+/, "").replace(/-Identity-[HV]$/, "");

interface Program {
  font: ReturnType<typeof fontkit.create>;
  /** Code PDF → identifiant de glyphe candidat(s). */
  glyphIds: (code: number, text: string) => number[];
}

function bytesOf(doc: PDFDocument, o: unknown): Uint8Array | undefined {
  const s = doc.context.lookup(o as never);
  if (!(s instanceof PDFRawStream)) return undefined;
  try {
    return decodePDFRawStream(s).decode();
  } catch {
    return undefined;
  }
}

function program(doc: PDFDocument, dict: PDFDict, subtype: string): Program | undefined {
  const look = (d: PDFDict, k: string) => doc.context.lookup(d.get(PDFName.of(k)));
  let fontDict = dict;
  if (subtype === "Type0") {
    const desc = look(dict, "DescendantFonts");
    const cid = desc instanceof PDFArray ? doc.context.lookup(desc.get(0)) : undefined;
    if (!(cid instanceof PDFDict) || nameOf(look(cid, "Subtype")) !== "CIDFontType2") return undefined;
    const enc = nameOf(look(dict, "Encoding"));
    if (enc !== "Identity-H" && enc !== "Identity-V") return undefined;
    fontDict = cid;
  } else if (subtype !== "TrueType") return undefined;
  const descriptor = look(fontDict, "FontDescriptor");
  if (!(descriptor instanceof PDFDict)) return undefined;
  const data = bytesOf(doc, descriptor.get(PDFName.of("FontFile2")));
  if (!data) return undefined;
  let font: ReturnType<typeof fontkit.create>;
  try {
    font = fontkit.create(data);
  } catch {
    return undefined;
  }
  if (subtype === "Type0") {
    // CID → identifiant de glyphe : identité, ou table CIDToGIDMap (2 octets par CID).
    const map = fontDict.get(PDFName.of("CIDToGIDMap"));
    const table = nameOf(doc.context.lookup(map)) === "Identity" || !map ? undefined : bytesOf(doc, map);
    return {
      font,
      glyphIds: (cid) => [table ? (table[cid * 2] << 8) | table[cid * 2 + 1] : cid],
    };
  }
  // TrueType simple : selon la table cmap présente, code direct, plage symbolique 0xF000 ou Unicode.
  return {
    font,
    glyphIds: (code, text) =>
      [text.codePointAt(0)!, 0xf000 + code, code].map((cp) => {
        try {
          return font.glyphForCodePoint(cp)?.id ?? 0;
        } catch {
          return 0;
        }
      }),
  };
}

function hasOutline(p: Program, gid: number, text: string): boolean {
  if (!gid) return false;
  try {
    const g = p.font.getGlyph(gid);
    const commands = (g?.path as unknown as { commands?: unknown[] } | undefined)?.commands;
    return /\s/.test(text) || !!commands?.length;
  } catch {
    return false;
  }
}

/** Polices du document portant le même nom que `primary` (hors préfixe de sous-ensemble). */
function sameFontDicts(doc: PDFDocument, primary: FontDictInfo, baseFont: string): FontDictInfo[] {
  const wanted = baseName(baseFont);
  const out: FontDictInfo[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (ref === primary.ref || !(obj instanceof PDFDict) || nameOf(obj.get(PDFName.of("Type"))) !== "Font") continue;
    const subtype = nameOf(obj.get(PDFName.of("Subtype"))) ?? "";
    if (subtype !== "Type0" && subtype !== "TrueType") continue;
    const name = nameOf(obj.get(PDFName.of("BaseFont")));
    if (name && baseName(name) === wanted) out.push({ ref, dict: obj, subtype });
  }
  return out;
}

/**
 * Sous-ensembles complémentaires : pour chacun, les caractères (absents de
 * `have`) dont le glyphe existe vraiment, avec leur code et leur largeur.
 */
export function findAlternates(doc: PDFDocument, primary: FontDictInfo, baseFont: string, have: Set<string>): AlternateFont[] {
  const out: AlternateFont[] = [];
  const covered = new Set(have);
  for (const info of sameFontDicts(doc, primary, baseFont)) {
    const codes = fontCodeMap(info);
    const prog = codes && program(doc, info.dict, info.subtype);
    if (!codes || !prog) continue;
    const metrics = fontMetrics(doc, info.dict);
    const glyphs: AlternateFont["glyphs"] = {};
    for (const [code, text] of codes.map) {
      if ([...text].length !== 1 || covered.has(text) || glyphs[text]) continue;
      if (!prog.glyphIds(code, text).some((gid) => hasOutline(prog, gid, text))) continue;
      const w = metrics?.width(code);
      glyphs[text] = { code, ...(w !== undefined ? { width: w * 1000 } : {}) };
    }
    if (!Object.keys(glyphs).length) continue;
    Object.keys(glyphs).forEach((ch) => covered.add(ch));
    const name = nameOf(info.dict.get(PDFName.of("BaseFont")))!;
    out.push({ baseFont: name, glyphs });
  }
  return out;
}
