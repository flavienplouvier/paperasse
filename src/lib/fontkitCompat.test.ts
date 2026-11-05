import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { compatFontkit } from "./fontkitCompat";

const TINOS_BOLD = "node_modules/@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf";

/** Police TrueType intégrée dans le PDF (sous-ensemble), relue avec fontkit. */
async function embeddedSubset(text: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(compatFontkit);
  const font = await doc.embedFont(readFileSync(TINOS_BOLD), { subset: true });
  doc.addPage().drawText(text, { x: 10, y: 10, size: 20, font });
  const saved = await PDFDocument.load(await doc.save());
  for (const [, obj] of saved.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("FontFile2"))) {
      const s = saved.context.lookup(obj.get(PDFName.of("FontFile2"))) as PDFRawStream;
      return fontkit.create(Buffer.from(decodePDFRawStream(s).decode()));
    }
  }
  throw new Error("pas de police intégrée");
}

describe("sous-ensembles TrueType", () => {
  it("restent lisibles quand un glyphe a une longueur impaire (Tinos Gras)", async () => {
    const font = await embeddedSubset("98x");
    for (let g = 0; g < font.numGlyphs; g++) expect((font.getGlyph(g).path as unknown as { commands: unknown[] }).commands.length).toBeGreaterThan(0);
  });
});
