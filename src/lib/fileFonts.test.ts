import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { fileFonts, fontNamesInDocument, readableFontName } from "./fileFonts";

describe("polices du fichier", () => {
  it("liste les polices utilisées, sans les polices techniques, les plus utilisées d'abord", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const times = await doc.embedFont(StandardFonts.TimesRomanBold);
    const zapf = await doc.embedFont(StandardFonts.ZapfDingbats);
    for (let i = 0; i < 3; i++) doc.addPage().drawText("a", { font: helv, x: 10, y: 10 });
    const p = doc.addPage();
    p.drawText("b", { font: times, x: 10, y: 10 });
    p.drawText("✓", { font: zapf, x: 10, y: 30 });
    const loaded = await PDFDocument.load(await doc.save());
    expect(fontNamesInDocument(loaded)).toEqual(["Helvetica", "Times-Bold"]);
  });

  it("met d'abord les polices disponibles (Marianne), puis les équivalents (Arial)", async () => {
    const doc = await PDFDocument.create();
    const a = await doc.embedFont(StandardFonts.Helvetica);
    const b = await doc.embedFont(StandardFonts.Courier);
    // Arial plus utilisée que Marianne : Marianne doit quand même venir en premier.
    for (let i = 0; i < 3; i++) doc.addPage().drawText("a", { font: a, x: 10, y: 10 });
    doc.addPage().drawText("b", { font: b, x: 10, y: 10 });
    const loaded = await PDFDocument.load(await doc.save());
    for (const [, o] of loaded.context.enumerateIndirectObjects()) {
      if (!(o instanceof PDFDict)) continue;
      const base = o.get(PDFName.of("BaseFont"))?.toString();
      if (base === "/Helvetica") o.set(PDFName.of("BaseFont"), PDFName.of("ABCDEF+ArialMT"));
      if (base === "/Courier") o.set(PDFName.of("BaseFont"), PDFName.of("GHIJKL+Marianne-Regular"));
    }
    const list = await fileFonts(await loaded.save());
    expect(list.map((f) => f.name)).toEqual(["Marianne Regular", "Arial"]);
    expect(list[0]).toMatchObject({ key: "etat:Marianne-Regular" });
    expect(list[0].substitute).toBeUndefined();
    expect(list[1].substitute).toBeTruthy();
  });

  it("donne un nom lisible", () => {
    expect(readableFontName("Marianne-ExtraBold")).toBe("Marianne Extra Bold");
    expect(readableFontName("ArialMT")).toBe("Arial");
    expect(readableFontName("Arial-BoldMT")).toBe("Arial Bold");
    expect(readableFontName("TimesNewRomanPSMT")).toBe("Times New Roman");
    expect(readableFontName("Calibri,Bold")).toBe("Calibri Bold");
  });
});
