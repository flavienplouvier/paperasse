import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { findFontDict, fontCodeMap, missingChars, segmentLine, type EmbeddedFont } from "./embeddedFonts";
import { findAlternates } from "./fontAlternates";
import { exportPdf } from "./exportPdf";
import type { TextAnnotation } from "./types";

const CARLITO = "node_modules/@expo-google-fonts/carlito/400Regular/Carlito_400Regular.ttf";

/**
 * PDF comme en produisent Word ou Acrobat : la même police en deux sous-ensembles
 * (préfixes AAAAAA+ et BBBBBB+), l'un pour « deux mois », l'autre pour « Preuve ».
 */
async function twoSubsets() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const ttf = readFileSync(CARLITO);
  const a = await doc.embedFont(ttf, { subset: true });
  const b = await doc.embedFont(ttf, { subset: true });
  const page = doc.addPage([595, 842]);
  page.drawText("deux mois", { x: 72, y: 700, size: 12, font: a });
  page.drawText("Preuve", { x: 72, y: 500, size: 12, font: b });
  const saved = await PDFDocument.load(await doc.save());
  const tags: Record<string, string> = {};
  for (const [, o] of saved.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFDict)) continue;
    const n = o.get(PDFName.of("BaseFont"));
    if (!(n instanceof PDFName) || !n.decodeText().startsWith("Carlito-Regular-")) continue;
    tags[n.decodeText()] ??= Object.keys(tags).length ? "BBBBBB" : "AAAAAA";
    o.set(PDFName.of("BaseFont"), PDFName.of(`${tags[n.decodeText()]}+Carlito-Regular`));
  }
  return saved.save();
}

/** Comme l'application : sous-ensemble principal + sous-ensembles complémentaires. */
function embeddedFor(doc: PDFDocument, baseFont: string, withAlternates = true): EmbeddedFont {
  const info = findFontDict(doc, baseFont)!;
  const glyphs: EmbeddedFont["glyphs"] = {};
  for (const [code, ch] of fontCodeMap(info)!.map) if ([...ch].length === 1) glyphs[ch] ??= { code, display: ch, width: 500 };
  const alternates = withAlternates ? findAlternates(doc, info, baseFont, new Set(Object.keys(glyphs))) : [];
  return { baseFont, cssFamily: "x", codeBytes: 2, glyphs, spaceWidth: 226, alternates };
}

const textAnnot = (text: string, embedded: EmbeddedFont): TextAnnotation => ({
  id: "t",
  pageId: "p",
  kind: "text",
  origin: [72, 300],
  text,
  fontKey: "std:Helvetica",
  fontSize: 12,
  color: "#000000",
  opacity: 1,
  rotation: 0,
  embedded,
});

async function readPage(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const items = (tc.items as { str: string; fontName: string; transform: number[] }[]).filter((i) => i.str.trim());
  const styles = tc.styles as Record<string, { fontFamily: string }>;
  return { items, styles };
}

describe("lettres absentes du sous-ensemble d'origine", () => {
  it("retrouve le « P » dans un autre sous-ensemble de la même police", async () => {
    const doc = await PDFDocument.load(await twoSubsets());
    const font = embeddedFor(doc, "AAAAAA+Carlito-Regular");
    expect(font.glyphs.P).toBeUndefined();
    expect(font.alternates).toHaveLength(1);
    expect(font.alternates![0].baseFont).toBe("BBBBBB+Carlito-Regular");
    expect(Object.keys(font.alternates![0].glyphs).sort()).toEqual(["P", "r", "v"]);
    // Plus aucun caractère ne demande la police de remplacement.
    expect(missingChars(font, "Preuve")).toEqual([]);
  });

  it("écrit « Preuve » uniquement avec les deux sous-ensembles d'origine, sans police de remplacement", async () => {
    const bytes = await twoSubsets();
    const font = embeddedFor(await PDFDocument.load(bytes), "AAAAAA+Carlito-Regular");
    const out = await exportPdf(bytes, ["p"], [textAnnot("Preuve", font)]);
    const doc = await PDFDocument.load(out);
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const names = fonts.keys().map((k) => (doc.context.lookup(fonts.get(k)) as PDFDict).get(PDFName.of("BaseFont"))!.toString());
    expect(names.some((n) => n.includes("Helvetica"))).toBe(false);
    const { items } = await readPage(out);
    const line = items.filter((i) => Math.abs(i.transform[5] - 300) < 0.5).map((i) => i.str).join("");
    expect(line).toBe("Preuve");
  });

  it("sinon, seule la lettre vraiment absente prend la police de remplacement, à la bonne place", async () => {
    const bytes = await twoSubsets();
    const font = embeddedFor(await PDFDocument.load(bytes), "AAAAAA+Carlito-Regular", false);
    expect(missingChars(font, "Preuve")).toEqual(["P", "r", "v"]);
    expect(segmentLine(font, "Preuve").map((s) => s.text)).toEqual(["Pr", "eu", "v", "e"]);
    const out = await exportPdf(bytes, ["p"], [textAnnot("Preuve", font)]);
    const { items, styles } = await readPage(out);
    const line = items.filter((i) => Math.abs(i.transform[5] - 300) < 0.5);
    expect(line.map((i) => i.str).join("")).toBe("Preuve");
    // « eu » et « e » gardent la police d'origine.
    const families = line.map((i) => `${i.str}:${styles[i.fontName].fontFamily}`);
    expect(families.filter((f) => /^(eu|e):/.test(f)).every((f) => !/helvetica/i.test(f))).toBe(true);
    // Les segments se suivent sans chevauchement.
    const xs = line.map((i) => i.transform[4]);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
  });

  it("ignore les polices d'un autre nom", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const a = await doc.embedFont(readFileSync(CARLITO), { subset: true });
    const h = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("abc", { font: a, x: 10, y: 10 });
    doc.addPage().drawText("PQR", { font: h, x: 10, y: 10 });
    const loaded = await PDFDocument.load(await doc.save());
    const name = (loaded.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Subtype"))?.toString() === "/Type0")![1] as PDFDict).get(PDFName.of("BaseFont"))!.toString().slice(1);
    expect(embeddedFor(loaded, name).alternates).toEqual([]);
  });
});
