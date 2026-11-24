import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { contentBytes } from "./removeText";
import { imageRect, removeImagesInRects, selectableImages } from "./pageImages";
import { exportPdf } from "./exportPdf";

// PNG 1 × 1 rouge.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

async function twoImages() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const img = await doc.embedPng(PNG);
  page.drawImage(img, { x: 50, y: 600, width: 100, height: 80 });
  page.drawImage(img, { x: 300, y: 100, width: 120, height: 60 });
  page.drawText("Bonjour", { x: 60, y: 500, size: 12 });
  // Relu depuis le fichier : flux de contenu tels qu'on les trouve dans un PDF ouvert.
  const loaded = await PDFDocument.load(await doc.save());
  return { doc: loaded, page: loaded.getPage(0) };
}

const draws = (bytes: Uint8Array) => (new TextDecoder().decode(bytes).match(/ Do\b/g) ?? []).length;

describe("images du PDF", () => {
  it("rectangle d'une image d'après sa matrice", () => {
    expect(imageRect([100, 0, 0, 80, 50, 600])).toEqual([50, 600, 150, 680]);
    // Image tournée d'un quart de tour.
    expect(imageRect([0, 100, -80, 0, 200, 600])).toEqual([120, 600, 200, 700]);
  });

  it("ignore les petites images et la page scannée", () => {
    const rects = selectableImages(
      [
        [0, 0, 600, 800],
        [10, 10, 13, 13],
        [50, 600, 150, 680],
        [50, 600, 150, 680],
      ],
      600 * 800,
    );
    expect(rects).toEqual([[50, 600, 150, 680]]);
  });

  it("retire seulement l'image de la zone", async () => {
    const { doc, page } = await twoImages();
    expect(draws(contentBytes(doc, page)!)).toBe(2);
    expect(removeImagesInRects(doc, page, [[50, 600, 150, 680]])).toEqual([1]);
    const after = contentBytes(doc, page)!;
    expect(draws(after)).toBe(1);
    expect(new TextDecoder().decode(after)).toContain("Tj");
  });

  it("ne touche à rien hors des images", async () => {
    const { doc, page } = await twoImages();
    expect(removeImagesInRects(doc, page, [[400, 400, 500, 500]])).toEqual([0]);
    expect(draws(contentBytes(doc, page)!)).toBe(2);
  });

  it("à l'enregistrement : image retirée, aucun cache blanc dessiné", async () => {
    const { doc } = await twoImages();
    const out = await exportPdf(await doc.save(), ["p"], [
      { id: "c", kind: "whiteout", pageId: "p", rect: [49.25, 599.25, 150.75, 680.75], width: 0, fill: true, color: "#ffffff", opacity: 1, removeImage: true },
    ]);
    const res = await PDFDocument.load(out);
    const content = new TextDecoder().decode(contentBytes(res, res.getPage(0))!);
    expect(draws(contentBytes(res, res.getPage(0))!)).toBe(1);
    // Pas de rectangle blanc ajouté par-dessus.
    expect(content).not.toMatch(/1 1 1 rg/);
  });
});
