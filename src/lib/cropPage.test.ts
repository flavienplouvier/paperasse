import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { cropAnnotations, cropPage, cropResolution, isImagePage } from "./cropPage";
import { exportPdf } from "./exportPdf";
import type { Annotation, Rect } from "./types";

// PNG 1 × 1 rouge.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

async function source(rotation = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.setRotation(degrees(rotation));
  page.drawText("Bonjour", { x: 60, y: 500, size: 12 });
  doc.addPage([600, 800]);
  return doc.save();
}

const box = (b: { x: number; y: number; width: number; height: number }) => [b.x, b.y, b.x + b.width, b.y + b.height];

describe("découpe d'une page", () => {
  it("en PDF : copie de la page réduite à la zone, insérée après l'originale", async () => {
    const r = await cropPage(await source(90), ["a", "b"], 0, [50, 450, 250, 650]);
    expect(r.pageIds).toHaveLength(3);
    expect(r.pageIds[0]).toBe("a");
    expect(r.pageIds[2]).toBe("b");
    const doc = await PDFDocument.load(r.bytes);
    expect(box(doc.getPage(0).getMediaBox())).toEqual([0, 0, 600, 800]);
    const p = doc.getPage(1);
    expect(box(p.getMediaBox())).toEqual([50, 450, 250, 650]);
    expect(box(p.getCropBox())).toEqual([50, 450, 250, 650]);
    expect(p.getRotation().angle).toBe(90);
  });

  it("en image : nouvelle page avec l'image à la place de la zone, même repère", async () => {
    const r = await cropPage(await source(), ["a", "b"], 1, [100, 200, 300, 260], { bytes: PNG, type: "png" });
    expect(r.pageIds.slice(0, 2)).toEqual(["a", "b"]);
    expect(r.pageIds).toHaveLength(3);
    const doc = await PDFDocument.load(r.bytes);
    const p = doc.getPage(2);
    expect(box(p.getMediaBox())).toEqual([100, 200, 300, 260]);
    // Les éléments ajoutés gardent leurs coordonnées : l'export dessine au bon endroit.
    const text: Annotation = { id: "t", kind: "text", pageId: r.pageIds[2], color: "#000000", opacity: 1, origin: [110, 230], text: "ok", fontKey: "helvetica", fontSize: 10, rotation: 0 };
    const out = await PDFDocument.load(await exportPdf(r.bytes, r.pageIds, [text]));
    expect(out.getPageCount()).toBe(3);
  });

  it("refuse une zone minuscule", async () => {
    await expect(cropPage(await source(), ["a", "b"], 0, [10, 10, 15, 300])).rejects.toThrow();
  });

  it("recopie les éléments qui touchent la zone, avec les caches de leur texte", () => {
    const base = { color: "#000000", opacity: 1, pageId: "p" };
    const list: Annotation[] = [
      { ...base, id: "in", kind: "rect", rect: [60, 60, 80, 80], width: 1, fill: false },
      { ...base, id: "out", kind: "rect", rect: [400, 400, 420, 420], width: 1, fill: false },
      { ...base, id: "other", pageId: "q", kind: "rect", rect: [60, 60, 80, 80], width: 1, fill: false },
      { ...base, id: "txt", kind: "text", origin: [70, 90], text: "Bonjour", fontKey: "helvetica", fontSize: 10, rotation: 0 },
      // Cache du texte, hors de la zone : il suit quand même son texte.
      { ...base, id: "cov", kind: "whiteout", rect: [300, 300, 310, 310], width: 0, fill: true, owner: "txt" },
    ];
    const zone: Rect = [50, 50, 150, 150];
    const out = cropAnnotations(list, "p", "new", zone);
    expect(out).toHaveLength(3);
    expect(out.every((a) => a.pageId === "new" && !["in", "txt", "cov"].includes(a.id))).toBe(true);
    const text = out.find((a) => a.kind === "text")!;
    const cover = out.find((a) => a.kind === "whiteout");
    expect(cover && cover.kind === "whiteout" && cover.owner).toBe(text.id);
    expect(out.find((a) => a.kind === "rect")!.kind === "rect" && (out.find((a) => a.kind === "rect") as { rect: Rect }).rect).toEqual([60, 60, 80, 80]);
  });

  it("résolution d'après les images de la zone, page d'image", () => {
    const photo = { rect: [0, 0, 595, 842] as Rect, width: 2200, height: 3113 };
    expect(cropResolution([photo], [100, 100, 300, 300])).toBeCloseTo(2200 / 595, 2);
    expect(cropResolution([], [100, 100, 300, 300])).toBe(4);
    expect(cropResolution([photo], [0, 0, 5000, 5000])).toBeCloseTo(6000 / 5000, 5);
    expect(isImagePage([photo], [0, 0, 595, 842])).toBe(true);
    expect(isImagePage([{ rect: [0, 0, 100, 100] }], [0, 0, 595, 842])).toBe(false);
  });
});
