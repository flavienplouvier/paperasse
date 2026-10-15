import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { addHeaderFooter, addPageNumbers, addWatermark, fillTemplate, placement } from "./pageDecor";
import { arrowHead } from "./geometry";
import { styleVariant, type FontEntry } from "./fonts";
import { exportPdf } from "./exportPdf";
import type { Annotation } from "./types";

async function doc(pages: { rotate?: number }[] = [{}, {}, {}]) {
  const d = await PDFDocument.create();
  for (const p of pages) {
    const page = d.addPage([595, 842]);
    if (p.rotate) page.setRotation(degrees(p.rotate));
  }
  d.setTitle("Rapport");
  return d.save();
}

/** Texte de chaque page et position (dans l'affichage) des fragments, via pdf.js. */
async function readPages(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const out: { text: string; items: { str: string; x: number; y: number }[]; w: number; h: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as { str: string; transform: number[] }[])
      .filter((it) => it.str.trim())
      .map((it) => {
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { str: it.str, x, y };
      });
    out.push({ text: items.map((it) => it.str).join(" "), items, w: vp.width, h: vp.height });
  }
  return out;
}

describe("outils du document", () => {
  it("remplit les variables des modèles", () => {
    expect(fillTemplate("Page {page} / {total} — {titre}", 2, 5, "Rapport")).toBe("Page 2 / 5 — Rapport");
  });

  it("place les coordonnées d'écran correctement sur une page tournée", async () => {
    const d = await PDFDocument.load(await doc([{ rotate: 90 }]));
    const p = placement(d.getPage(0));
    expect([p.width, p.height]).toEqual([842, 595]);
    // Le coin haut-gauche affiché d'une page tournée de 90° est l'origine PDF.
    expect(p.toPdf(0, 0)).toEqual([0, 0]);
    expect(p.toPdf(10, 20)).toEqual([20, 10]);
  });

  it("numérote les pages en bas au centre, y compris la page tournée", async () => {
    const bytes = await addPageNumbers(await doc([{}, { rotate: 90 }, {}]), {
      format: "Page {page} / {total}",
      vertical: "bottom",
      horizontal: "center",
      start: 1,
      size: 10,
      color: "#333333",
      margin: 28,
    });
    const pages = await readPages(bytes);
    expect(pages.map((p) => p.text)).toEqual(["Page 1 / 3", "Page 2 / 3", "Page 3 / 3"]);
    for (const p of pages) {
      const item = p.items[0];
      // Ligne de base à 28 pt du bas de la page affichée, texte centré.
      expect(item.y).toBeCloseTo(p.h - 28, 0);
      expect(Math.abs(item.x + 30 - p.w / 2)).toBeLessThan(40);
    }
  });

  it("peut ignorer la page de garde", async () => {
    const bytes = await addPageNumbers(await doc(), {
      format: "{page}",
      vertical: "top",
      horizontal: "right",
      start: 1,
      size: 10,
      color: "#000000",
      margin: 20,
      skipFirst: true,
    });
    expect((await readPages(bytes)).map((p) => p.text)).toEqual(["", "1", "2"]);
  });

  it("ajoute en-tête et pied de page avec variables", async () => {
    const bytes = await addHeaderFooter(await doc([{}, {}]), {
      header: ["", "{titre}", ""],
      footer: ["", "", "Page {page} / {total}"],
      size: 9,
      color: "#000000",
      margin: 24,
    });
    const pages = await readPages(bytes);
    expect(pages[1].text).toContain("Rapport");
    expect(pages[1].text).toContain("Page 2 / 2");
  });

  it("ajoute un filigrane sur chaque page", async () => {
    const bytes = await addWatermark(await doc([{}, { rotate: 270 }]), {
      text: "CONFIDENTIEL",
      size: 96,
      color: "#c62828",
      opacity: 0.2,
      diagonal: true,
    });
    expect((await readPages(bytes)).map((p) => p.text)).toEqual(["CONFIDENTIEL", "CONFIDENTIEL"]);
  });

  it("refuse clairement un caractère hors alphabet latin", async () => {
    await expect(
      addWatermark(await doc([{}]), { text: "秘密", size: 96, color: "#000000", opacity: 0.2, diagonal: false }),
    ).rejects.toThrow(/Caractère non pris en charge/);
  });
});

describe("mise en forme et outils", () => {
  it("trouve les variantes gras/italique d'une police", () => {
    const std = (key: string, bold: boolean, italic: boolean): FontEntry => ({ key, label: key, source: "standard", cssFamily: "x", bold, italic });
    const fonts = [
      std("std:Helvetica", false, false),
      std("std:Helvetica-Bold", true, false),
      std("std:Helvetica-Oblique", false, true),
      std("std:Helvetica-BoldOblique", true, true),
    ];
    expect(styleVariant("std:Helvetica", true, false, fonts)).toBe("std:Helvetica-Bold");
    expect(styleVariant("std:Helvetica-Bold", true, true, fonts)).toBe("std:Helvetica-BoldOblique");
  });

  it("dessine une pointe de flèche symétrique", () => {
    const [a, b] = arrowHead([0, 0], [100, 0], 2);
    expect(a[0]).toBeCloseTo(b[0]);
    expect(a[1]).toBeCloseTo(-b[1]);
    expect(a[0]).toBeLessThan(100);
  });

  it("exporte texte souligné et flèche", async () => {
    const base = { pageId: "p", color: "#000000", opacity: 1 };
    const annotations: Annotation[] = [
      { ...base, id: "1", kind: "text", origin: [50, 700], text: "Souligné", fontKey: "std:Helvetica", fontSize: 14, rotation: 0, underline: true },
      { ...base, id: "2", kind: "line", from: [50, 600], to: [200, 650], width: 2, arrow: true },
    ];
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    const out = await exportPdf(await d.save(), ["p"], annotations);
    expect((await readPages(out))[0].text).toContain("Souligné");
  });
});
