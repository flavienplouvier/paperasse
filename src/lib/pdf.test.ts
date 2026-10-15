import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as ops from "./pageOps";
import { exportPdf } from "./exportPdf";
import { fillForm, readFormFields } from "./forms";
import { screenAxes, normalizeRect, normalizeRotation } from "./geometry";
import { simplifyPath, translateAnnotation } from "./annotations";
import { matchFont, normalizeFontName, type FontEntry } from "./fonts";
import { searchRuns, runAt, type TextRun } from "./text";
import type { Annotation } from "./types";

async function samplePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Page ${i + 1}`, { x: 50, y: 780, size: 24, font });
  }
  return doc.save();
}

const pageSizes = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle]);

describe("géométrie", () => {
  it("normalise les rectangles et les rotations", () => {
    expect(normalizeRect([10, 50], [2, 5])).toEqual([2, 5, 10, 50]);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
  });

  it("donne les axes écran dans l'espace PDF pour chaque rotation", () => {
    expect(screenAxes(0)).toEqual({ right: [1, 0], down: [0, -1] });
    expect(screenAxes(90)).toEqual({ right: [0, 1], down: [1, 0] });
    expect(screenAxes(180)).toEqual({ right: [-1, 0], down: [0, 1] });
    expect(screenAxes(270)).toEqual({ right: [0, -1], down: [-1, 0] });
  });
});

describe("annotations", () => {
  it("déplace chaque type d'annotation", () => {
    const base = { id: "a", pageId: "p", color: "#000000", opacity: 1 };
    const text: Annotation = { ...base, kind: "text", origin: [10, 10], text: "x", fontKey: "std:Helvetica", fontSize: 12, rotation: 0 };
    const ink: Annotation = { ...base, kind: "ink", points: [[0, 0], [1, 1]], width: 1 };
    const rect: Annotation = { ...base, kind: "rect", rect: [0, 0, 5, 5], width: 1, fill: false };
    expect(translateAnnotation(text, 5, -5)).toMatchObject({ origin: [15, 5] });
    expect(translateAnnotation(ink, 1, 1)).toMatchObject({ points: [[1, 1], [2, 2]] });
    expect(translateAnnotation(rect, 2, 3)).toMatchObject({ rect: [2, 3, 7, 8] });
  });

  it("simplifie un tracé rectiligne à ses extrémités", () => {
    const pts: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, i * 2]);
    expect(simplifyPath(pts, 0.5)).toEqual([[0, 0], [49, 98]]);
  });
});

describe("opérations sur les pages", () => {
  it("supprime, déplace, duplique et insère des pages en gardant les identifiants", async () => {
    const bytes = await samplePdf(3);
    const ids = ["a", "b", "c"];

    const del = await ops.deletePages(bytes, ids, new Set(["b"]));
    expect(del.pageIds).toEqual(["a", "c"]);
    expect(await pageSizes(del.bytes)).toHaveLength(2);

    const moved = await ops.movePage(bytes, ids, 0, 2);
    expect(moved.pageIds).toEqual(["b", "c", "a"]);

    const dup = await ops.duplicatePage(bytes, ids, 1);
    expect(dup.pageIds).toHaveLength(4);
    expect(dup.pageIds.slice(0, 2)).toEqual(["a", "b"]);
    expect(dup.pageIds[3]).toBe("c");

    const blank = await ops.insertBlankPage(bytes, ids, 0);
    expect(blank.pageIds[0]).toBe("a");
    expect(blank.pageIds[2]).toBe("b");
    expect(await pageSizes(blank.bytes)).toHaveLength(4);
  });

  it("refuse de supprimer toutes les pages", async () => {
    await expect(ops.deletePages(await samplePdf(1), ["a"], new Set(["a"]))).rejects.toThrow();
  });

  it("tourne uniquement les pages choisies", async () => {
    const r = await ops.rotatePages(await samplePdf(2), ["a", "b"], new Set(["b"]), 90);
    expect((await pageSizes(r.bytes)).map((p) => p[2])).toEqual([0, 90]);
    const back = await ops.rotatePages(r.bytes, r.pageIds, new Set(["b"]), -180);
    expect((await pageSizes(back.bytes)).map((p) => p[2])).toEqual([0, 270]);
  });

  it("fusionne et extrait", async () => {
    const merged = await ops.appendDocuments(await samplePdf(2), ["a", "b"], [await samplePdf(3)]);
    expect(merged.pageIds).toHaveLength(5);
    const part = await ops.extractPages(merged.bytes, [0, 4]);
    expect(await pageSizes(part)).toHaveLength(2);
  });

  it("convertit des images en PDF", async () => {
    // PNG 1×1 rouge
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const out = await ops.imagesToPdf([{ bytes: png, type: "image/png" }]);
    expect(await pageSizes(out)).toEqual([[1, 1, 0]]);
  });
});

describe("export", () => {
  it("dessine les annotations et conserve les pages", async () => {
    const bytes = await samplePdf(2);
    const base = { pageId: "b", color: "#e5484d", opacity: 1 };
    const annotations: Annotation[] = [
      { ...base, id: "1", kind: "text", origin: [72, 700], text: "Été — Ça marche !\nDeuxième ligne", fontKey: "std:Helvetica", fontSize: 14, rotation: 0 },
      { ...base, id: "2", kind: "ink", points: [[10, 10], [50, 60], [90, 20]], width: 2 },
      { ...base, id: "3", kind: "highlight", rect: [50, 770, 200, 800], width: 0, fill: true },
      { ...base, id: "4", kind: "whiteout", rect: [45, 775, 160, 810], width: 0, fill: true, color: "#ffffff" },
      { ...base, id: "5", kind: "ellipse", rect: [100, 100, 200, 160], width: 1.5, fill: false },
      { ...base, id: "6", kind: "line", from: [0, 0], to: [100, 100], width: 3 },
    ];
    const out = await exportPdf(bytes, ["a", "b"], annotations);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getProducer()).toBe("Paperasse PDF");
    expect(out.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("signale clairement un caractère absent d'une police standard", async () => {
    const annotations: Annotation[] = [
      { id: "1", pageId: "a", color: "#000000", opacity: 1, kind: "text", origin: [72, 700], text: "日本語", fontKey: "std:Helvetica", fontSize: 12, rotation: 0 },
    ];
    await expect(exportPdf(await samplePdf(1), ["a"], annotations)).rejects.toThrow(/ne contient pas/);
  });

  it("écrit du texte tourné sur une page tournée", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).setRotation(degrees(90));
    const annotations: Annotation[] = [
      { id: "1", pageId: "a", color: "#000000", opacity: 1, kind: "text", origin: [300, 400], text: "Tourné", fontKey: "std:Times-Roman", fontSize: 12, rotation: 90 },
    ];
    const out = await exportPdf(await doc.save(), ["a"], annotations);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });
});

describe("formulaires", () => {
  it("lit et remplit les champs", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();
    form.createTextField("nom").addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
    form.createCheckBox("accord").addToPage(page, { x: 50, y: 650, width: 16, height: 16 });
    const dd = form.createDropdown("pays");
    dd.addOptions(["France", "Belgique"]);
    dd.addToPage(page, { x: 50, y: 600, width: 120, height: 24 });
    const bytes = await doc.save();

    const fields = await readFormFields(bytes);
    expect(fields.map((f) => f.kind).sort()).toEqual(["checkbox", "choice", "text"]);

    const filled = await fillForm(bytes, { nom: "Dupont", accord: true, pays: "Belgique" });
    const after = await readFormFields(filled);
    expect(after.find((f) => f.name === "nom")?.value).toBe("Dupont");
    expect(after.find((f) => f.name === "accord")?.value).toBe(true);
    expect(after.find((f) => f.name === "pays")?.value).toBe("Belgique");
  });
});

describe("polices", () => {
  const local = (ps: string, family: string, style: string): FontEntry => ({
    key: `local:${ps}`,
    label: `${family} ${style}`,
    source: "local",
    cssFamily: "x",
    postscriptName: ps,
    family,
    style,
  });

  it("normalise les noms de police PDF", () => {
    expect(normalizeFontName("ABCDEF+Calibri-Bold")).toBe("calibribold");
    expect(normalizeFontName("ArialMT")).toBe("arial");
  });

  it("retrouve la police installée correspondant au PDF", () => {
    const fonts = [local("Calibri", "Calibri", "Regular"), local("Calibri-Bold", "Calibri", "Bold"), local("Arial-ItalicMT", "Arial", "Italic")];
    expect(matchFont("QWERTY+Calibri-Bold", fonts)).toBe("local:Calibri-Bold");
    expect(matchFont("Calibri", fonts)).toBe("local:Calibri");
    expect(matchFont("Arial-ItalicMT", fonts)).toBe("local:Arial-ItalicMT");
  });

  it("se replie sur la police standard la plus proche", () => {
    expect(matchFont("ABCDEF+TimesNewRomanPS-BoldMT", [])).toBe("std:Times-Bold");
    expect(matchFont("CourierNew", [])).toBe("std:Courier");
    expect(matchFont("Verdana-Italic", [])).toBe("std:Helvetica-Oblique");
    expect(matchFont(undefined, [])).toBe("std:Helvetica");
  });
});

describe("texte et recherche", () => {
  const run = (str: string, x: number, y: number): TextRun => ({
    str,
    rect: [x, y - 3, x + str.length * 6, y + 11],
    baseline: [x, y],
    fontSize: 12,
    fontName: "f1",
    angle: 0,
  });

  it("trouve le fragment sous le doigt", () => {
    const runs = [run("Bonjour", 10, 100), run("le monde", 10, 80)];
    expect(runAt(runs, [20, 102])?.str).toBe("Bonjour");
    expect(runAt(runs, [20, 82])?.str).toBe("le monde");
    expect(runAt(runs, [500, 500])).toBeUndefined();
  });

  it("cherche sans tenir compte de la casse ni des accents", () => {
    const hits = searchRuns([run("Été à Évry, été chaud", 0, 100)], 0, "ete");
    expect(hits).toHaveLength(2);
    expect(hits[0].rect[0]).toBe(0);
    expect(hits[1].rect[0]).toBeGreaterThan(hits[0].rect[0]);
  });
});
