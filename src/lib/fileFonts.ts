import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { documentFontFor } from "./documentFonts";
import { getFont, matchFont, normalizeFontName, parseFontName } from "./fonts";

/**
 * Polices utilisées dans le fichier, proposées en tête du sélecteur pour que
 * le texte ajouté s'accorde au document (ex. Marianne sur un Cerfa).
 */

export interface FileFont {
  /** Nom d'origine lisible (« Marianne ExtraBold »). */
  name: string;
  /** Police utilisée par Paperasse pour l'écrire. */
  key: string;
  /** Nom de l'équivalent quand la police d'origine n'est pas disponible (« Arimo »). */
  substitute?: string;
}

/** Polices purement techniques (cases à cocher, symboles) : pas proposées pour écrire. */
const TECHNICAL = /^(zapfdingbats|symbol|wingdings|webdings)/;

const nameOf = (o: unknown) => (o instanceof PDFName ? o.decodeText() : undefined);

/** Noms des polices du fichier (sans préfixe de sous-ensemble), les plus utilisées d'abord. */
export function fontNamesInDocument(doc: PDFDocument, maxPages = 50): string[] {
  const uses = new Map<string, number>();
  const seenDicts = new Set<PDFDict>();
  const visitResources = (res: unknown, depth: number) => {
    const resources = doc.context.lookup(res as never);
    if (!(resources instanceof PDFDict) || seenDicts.has(resources) || depth > 4) return;
    seenDicts.add(resources);
    const fonts = doc.context.lookup(resources.get(PDFName.of("Font")));
    if (fonts instanceof PDFDict) {
      for (const [, ref] of fonts.entries()) {
        const font = doc.context.lookup(ref);
        if (!(font instanceof PDFDict) || nameOf(font.get(PDFName.of("Subtype"))) === "Type3") continue;
        const base = nameOf(font.get(PDFName.of("BaseFont")))?.replace(/^[A-Z]{6}\+/, "").replace(/-Identity-[HV]$/, "");
        if (!base || TECHNICAL.test(base.toLowerCase())) continue;
        uses.set(base, (uses.get(base) ?? 0) + 1);
      }
    }
    // Sous-dessins (XObjects de formulaire) : leurs polices comptent aussi.
    const xobjects = doc.context.lookup(resources.get(PDFName.of("XObject")));
    if (xobjects instanceof PDFDict) {
      for (const [, ref] of xobjects.entries()) {
        const x = doc.context.lookup(ref);
        if (x instanceof PDFStream && nameOf(x.dict.get(PDFName.of("Subtype"))) === "Form") visitResources(x.dict.get(PDFName.of("Resources")), depth + 1);
      }
    }
  };
  for (const page of doc.getPages().slice(0, maxPages)) {
    visitResources(page.node.get(PDFName.of("Resources")) ?? page.node.Resources(), 0);
    // Apparences des champs de formulaire (texte saisi dans un Cerfa…).
    const annots = page.node.Annots();
    if (annots instanceof PDFArray) {
      for (const a of annots.asArray()) {
        const ap = doc.context.lookup((doc.context.lookup(a) as PDFDict | undefined)?.get(PDFName.of("AP")));
        const n = ap instanceof PDFDict ? doc.context.lookup(ap.get(PDFName.of("N"))) : undefined;
        if (n instanceof PDFStream) visitResources(n.dict.get(PDFName.of("Resources")), 1);
      }
    }
  }
  return [...uses].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** « Marianne-ExtraBold » → « Marianne ExtraBold », « ArialMT » → « Arial », « Arial,Bold » → « Arial Bold ». */
export function readableFontName(name: string): string {
  return name
    .replace(/(PS)?MT$/, "")
    .replace(/[-,_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Polices du fichier et la police utilisée pour chacune (source autorisée, sinon équivalent). */
export async function fileFonts(bytes: Uint8Array): Promise<FileFont[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return [];
  }
  const out: FileFont[] = [];
  const keys = new Set<string>();
  for (const original of fontNamesInDocument(doc)) {
    const key = documentFontFor(original) ?? matchFont(original);
    if (keys.has(key)) continue;
    keys.add(key);
    const font = getFont(key);
    const base = parseFontName(original).base;
    const sameFamily = normalizeFontName(font.family ?? font.label).startsWith(base);
    out.push({ name: readableFontName(original), key, ...(sameFamily ? {} : { substitute: font.family ?? font.label }) });
  }
  // Polices vraiment disponibles (ex. Marianne) d'abord, puis les équivalents ; usage décroissant dans chaque groupe.
  return [...out.filter((f) => !f.substitute), ...out.filter((f) => f.substitute)];
}
