import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  findFontDict,
  fontCodeMap,
  missingChars,
  parseToUnicode,
  usesEmbedded,
  type EmbeddedFont,
} from "./embeddedFonts";
import { exportPdf } from "./exportPdf";
import type { TextAnnotation } from "./types";

describe("tables ToUnicode", () => {
  it("lit bfchar et bfrange (plages et tableaux)", () => {
    const cmap = `
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      2 beginbfchar
      <0003> <0020>
      <0024> <0041>
      endbfchar
      2 beginbfrange
      <0044> <0046> <0061>
      <0050> <0051> [<00E9> <00E8>]
      endbfrange`;
    const { map, codeBytes } = parseToUnicode(cmap);
    expect(codeBytes).toBe(2);
    expect(map.get(0x03)).toBe(" ");
    expect(map.get(0x24)).toBe("A");
    expect([map.get(0x44), map.get(0x45), map.get(0x46)]).toEqual(["a", "b", "c"]);
    expect([map.get(0x50), map.get(0x51)]).toEqual(["é", "è"]);
  });
});

// Police TrueType réelle pour créer un PDF avec une police incorporée en sous-ensemble.
const ttf = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find((p) => existsSync(p));

async function pdfWithSubset(text: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(ttf!), { subset: true });
  doc.addPage([595, 842]).drawText(text, { x: 50, y: 700, size: 14, font });
  const bytes = await doc.save();
  // Nom réel du dictionnaire Type0 (pdf-lib suffixe le nom PostScript), comme le lit pdf.js.
  const reloaded = await PDFDocument.load(bytes);
  const type0 = reloaded.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .find((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of("Subtype"))?.toString() === "/Type0")!;
  const baseFont = (type0.get(PDFName.of("BaseFont")) as PDFName).decodeText();
  return { bytes, baseFont };
}

/** En navigateur, l'aperçu vient de pdf.js ; ici on garde le caractère tel quel. */
function embeddedFrom(doc: PDFDocument, baseFont: string): EmbeddedFont {
  const info = findFontDict(doc, baseFont)!;
  const codes = fontCodeMap(info)!;
  const glyphs: EmbeddedFont["glyphs"] = {};
  for (const [code, ch] of codes.map) if ([...ch].length === 1) glyphs[ch] ??= { code, display: ch, width: 556 };
  return { baseFont, cssFamily: "x", codeBytes: codes.codeBytes, glyphs, spaceWidth: 278 };
}

const countFonts = (doc: PDFDocument) =>
  doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Subtype"))?.toString() === "/Type0").length;

async function extractText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false } as never).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  return (content.items as { str: string; fontName: string }[]).map((i) => i.str).join("|");
}

describe("police standard non incorporée (Courier, Times, Helvetica)", () => {
  it("réécrit le texte avec la police standard d'origine, sans police de remplacement", async () => {
    const d = await PDFDocument.create();
    const courier = await d.embedFont("Courier");
    d.addPage([595, 842]).drawText("Et celle-ci", { x: 50, y: 700, size: 13, font: courier });
    const bytes = await d.save();
    const doc = await PDFDocument.load(bytes);
    const info = findFontDict(doc, "Courier")!;
    const codes = fontCodeMap(info)!;
    expect(codes.codeBytes).toBe(1);
    expect(codes.map.get(0xe9)).toBe("é");

    const glyphs: EmbeddedFont["glyphs"] = {};
    for (const [code, ch] of codes.map) glyphs[ch] ??= { code, display: ch, width: 600 };
    const a: TextAnnotation = {
      id: "t",
      pageId: "p",
      kind: "text",
      origin: [50, 650],
      text: "Et cellle-ci, éàç",
      fontKey: "lib:cousine:regular",
      fontSize: 13,
      color: "#000000",
      opacity: 1,
      rotation: 0,
      embedded: { baseFont: "Courier", cssFamily: "x", codeBytes: 1, glyphs, spaceWidth: 600, notEmbedded: true },
    };
    expect(usesEmbedded(a)).toBe(true);
    const out = await exportPdf(bytes, ["p"], [a]);
    // Aucune police ajoutée : seule la police Courier d'origine est présente.
    const fontsAfter = (await PDFDocument.load(out)).context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Type"))?.toString() === "/Font");
    expect(fontsAfter).toHaveLength(1);
    // pdf.js découpe le texte extrait en fragments ; on les recolle pour comparer.
    expect((await extractText(out)).replaceAll("|", "")).toContain("Et cellle-ci, éàç");
  });
});

describe.skipIf(!ttf)("police incorporée d'origine", () => {
  it("retrouve la police du document et ses caractères", async () => {
    const { bytes, baseFont } = await pdfWithSubset("Bonjour le monde");
    const doc = await PDFDocument.load(bytes);
    const font = embeddedFrom(doc, baseFont);
    expect(font.codeBytes).toBe(2);
    expect(Object.keys(font.glyphs).sort().join("")).toBe(" Bdejlmnoru");
    expect(missingChars(font, "le monde")).toEqual([]);
    expect(missingChars(font, "Zébu")).toEqual(["Z", "é", "b"]);
  });

  it("écrit le texte modifié avec la police d'origine, sans en ajouter", async () => {
    const { bytes, baseFont } = await pdfWithSubset("Bonjour le monde");
    const before = await PDFDocument.load(bytes);
    const a: TextAnnotation = {
      id: "t",
      pageId: "p",
      kind: "text",
      origin: [50, 600],
      text: "le monde Bonjour",
      fontKey: "std:Helvetica",
      fontSize: 14,
      color: "#000000",
      opacity: 1,
      rotation: 0,
      embedded: embeddedFrom(before, baseFont),
    };
    // Tous les caractères existent dans le sous-ensemble « Bonjour le monde ».
    expect(usesEmbedded(a)).toBe(true);

    const out = await exportPdf(bytes, ["p"], [a]);
    const after = await PDFDocument.load(out);
    expect(countFonts(after)).toBe(countFonts(before));
    expect(await extractText(out)).toContain("le monde Bonjour");
  });

  it("positionne les mots quand la police n'incorpore pas l'espace", async () => {
    const { bytes, baseFont } = await pdfWithSubset("Bonjour le monde");
    const font = embeddedFrom(await PDFDocument.load(bytes), baseFont);
    delete font.glyphs[" "];
    const a: TextAnnotation = {
      id: "t",
      pageId: "p",
      kind: "text",
      origin: [50, 600],
      text: "monde Bonjour",
      fontKey: "std:Helvetica",
      fontSize: 14,
      color: "#000000",
      opacity: 1,
      rotation: 0,
      embedded: font,
    };
    expect(usesEmbedded(a)).toBe(true);
    const text = await extractText(await exportPdf(bytes, ["p"], [a]));
    expect(text).toContain("monde");
    expect(text).toContain("Bonjour");
  });

  it("se replie sur la police de remplacement si un caractère manque", async () => {
    const { bytes, baseFont } = await pdfWithSubset("Bonjour le monde");
    const a: TextAnnotation = {
      id: "t",
      pageId: "p",
      kind: "text",
      origin: [50, 600],
      text: "Zébre",
      fontKey: "std:Helvetica",
      fontSize: 14,
      color: "#000000",
      opacity: 1,
      rotation: 0,
      embedded: embeddedFrom(await PDFDocument.load(bytes), baseFont),
    };
    expect(usesEmbedded(a)).toBe(false);
    const out = await exportPdf(bytes, ["p"], [a]);
    expect(await extractText(out)).toContain("Zébre");
  });
});
