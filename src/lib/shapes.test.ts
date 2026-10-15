import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { SHAPES } from "./shapes";
import { shapeBox } from "./geometry";
import { exportPdf } from "./exportPdf";
import type { Annotation } from "./types";

describe("formes", () => {
  it("propose au moins 20 formes, toutes avec un tracé valide", () => {
    const closed = SHAPES.filter((s) => !s.linear);
    expect(SHAPES.length).toBeGreaterThanOrEqual(20);
    for (const s of closed) {
      const d = s.path!(120, 80);
      expect(d).toMatch(/^M[\d.]+ [\d.]+/);
      expect(d).not.toMatch(/NaN|undefined/);
    }
  });

  it("calcule la boîte affichée selon la rotation de la page", () => {
    expect(shapeBox([10, 20, 110, 70], 0)).toEqual({ origin: [10, 70], width: 100, height: 50 });
    expect(shapeBox([10, 20, 110, 70], 90)).toEqual({ origin: [10, 20], width: 50, height: 100 });
    expect(shapeBox([10, 20, 110, 70], 180)).toEqual({ origin: [110, 20], width: 100, height: 50 });
    expect(shapeBox([10, 20, 110, 70], 270)).toEqual({ origin: [110, 70], width: 50, height: 100 });
  });

  for (const rotation of [0, 90]) {
    it(`exporte toutes les formes, pleines et en contour (page tournée de ${rotation}°)`, async () => {
      const d = await PDFDocument.create();
      d.addPage([595, 842]).setRotation(degrees(rotation));
      const annotations: Annotation[] = SHAPES.filter((s) => !s.linear).flatMap((s, i) => [
        { id: `${s.id}-f`, pageId: "p", kind: "shape", shape: s.id, rect: [20 + (i % 6) * 90, 40 + Math.floor(i / 6) * 90, 90 + (i % 6) * 90, 100 + Math.floor(i / 6) * 90], width: 2, fill: true, color: "#e5484d", opacity: 0.8, rotation },
        { id: `${s.id}-o`, pageId: "p", kind: "shape", shape: s.id, rect: [20, 500, 120, 580], width: 1.5, fill: false, color: "#0090ff", opacity: 1, rotation },
      ]);
      annotations.push({ id: "dbl", pageId: "p", kind: "line", from: [50, 700], to: [250, 760], width: 2, arrow: true, arrowStart: true, color: "#000000", opacity: 1 });
      const out = await exportPdf(await d.save(), ["p"], annotations);
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
      expect(out.byteLength).toBeGreaterThan(2000);
    });
  }
});
