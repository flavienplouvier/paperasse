import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as ops from "./pageOps";
import { exportPdf, LINE_HEIGHT } from "./exportPdf";
import { fillForm, readFormFields } from "./forms";
import { duplicateAnnotation } from "./annotations";
import type { Annotation, FieldAnnotation, TextAnnotation } from "./types";

/**
 * Tests de bout en bout des modifications : le PDF produit est relu avec
 * pdf.js (comme le ferait un lecteur PDF) pour vérifier que chaque
 * modification est au bon endroit, sur la bonne page, sans perdre l'existant.
 */

async function samplePdf(pages = 3, rotations: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Page ${i + 1}`, { x: 50, y: 780, size: 24, font });
    if (rotations[i]) p.setRotation(degrees(rotations[i]));
  }
  return doc.save();
}

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  return { pdfjs, pdf };
}

/** Fragments de texte de chaque page, avec leur position telle qu'affichée (origine en haut à gauche). */
async function readPages(bytes: Uint8Array) {
  const { pdf } = await openPdf(bytes);
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

/** Opérations de dessin d'une page, dans l'ordre (pdf.js). */
async function operators(bytes: Uint8Array, pageNumber = 1) {
  const { pdfjs, pdf } = await openPdf(bytes);
  const list = await (await pdf.getPage(pageNumber)).getOperatorList();
  const names = new Map<number, string>(Object.entries(pdfjs.OPS).map(([k, v]) => [v as number, k]));
  return list.fnArray.map((fn: number) => names.get(fn) ?? String(fn));
}

const text = (pageId: string, str: string, origin: [number, number], extra: Partial<TextAnnotation> = {}): TextAnnotation => ({
  id: `t-${str}`,
  pageId,
  color: "#000000",
  opacity: 1,
  kind: "text",
  origin,
  text: str,
  fontKey: "std:Helvetica",
  fontSize: 12,
  rotation: 0,
  ...extra,
});

const field = (pageId: string, name: string, fieldType: FieldAnnotation["fieldType"], y: number, extra: Partial<FieldAnnotation> = {}): FieldAnnotation => ({
  id: `f-${name}-${y}`,
  pageId,
  color: "#000000",
  opacity: 1,
  kind: "field",
  rect: [50, y, 250, y + 24],
  fieldType,
  name,
  fontSize: 0,
  ...extra,
});

// PNG 1×1 rouge
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("ajout de texte", () => {
  it("écrit le texte à la position demandée et conserve le contenu d'origine", async () => {
    const out = await exportPdf(await samplePdf(1), ["a"], [text("a", "Ajouté ici", [100, 500])]);
    const [page] = await readPages(out);
    expect(page.text).toContain("Page 1");
    const added = page.items.find((it) => it.str === "Ajouté ici")!;
    expect(added).toBeDefined();
    expect(added.x).toBeCloseTo(100, 0);
    expect(added.y).toBeCloseTo(842 - 500, 0);
  });

  it("espace les lignes d'un texte multiligne selon l'interligne", async () => {
    const a = text("a", "Ligne un\nLigne deux\n\nLigne quatre", [72, 600], { fontSize: 20 });
    const [page] = await readPages(await exportPdf(await samplePdf(1), ["a"], [a]));
    const y = (s: string) => page.items.find((it) => it.str === s)!.y;
    expect(y("Ligne deux") - y("Ligne un")).toBeCloseTo(20 * LINE_HEIGHT, 1);
    // La ligne vide garde sa place.
    expect(y("Ligne quatre") - y("Ligne un")).toBeCloseTo(3 * 20 * LINE_HEIGHT, 1);
  });

  it("place le texte comme à l'écran sur une page tournée de 90°", async () => {
    // Sur une page tournée de 90°, le texte est créé avec rotation 90 : il se lit horizontalement à l'écran.
    const out = await exportPdf(await samplePdf(1, [90]), ["a"], [text("a", "Horizontal", [300, 200], { rotation: 90 })]);
    const [page] = await readPages(out);
    expect([page.w, page.h]).toEqual([842, 595]);
    const item = page.items.find((it) => it.str === "Horizontal")!;
    // Point PDF (300, 200) sur une page tournée de 90° → (y, x) à l'écran.
    expect(item.x).toBeCloseTo(200, 0);
    expect(item.y).toBeCloseTo(300, 0);
  });
});

describe("modifier le texte (cache blanc + texte de remplacement)", () => {
  it("dessine le cache de « Modifier le texte » sous le texte, quel que soit l'ordre", async () => {
    // Cache d'une ligne modifiée (removeText) ; ici la ligne d'origine n'existe pas, le cache est donc dessiné.
    const annotations: Annotation[] = [
      text("a", "Nouveau titre", [50, 780], { fontSize: 24 }),
      { id: "w", pageId: "a", color: "#ffffff", opacity: 1, kind: "whiteout", rect: [45, 772, 200, 806], width: 0, fill: true, removeText: { origin: [400, 100], angle: 0, width: 10, fontSize: 10 } },
    ];
    const out = await exportPdf(await samplePdf(1), ["a"], annotations);
    const fns = await operators(out);
    // pdf.js 6 regroupe tracé et remplissage dans « constructPath ».
    // Le cache (seul tracé de la page) précède le texte de remplacement.
    const cache = fns.indexOf("constructPath");
    const lastText = fns.lastIndexOf("showText");
    expect(cache).toBeGreaterThan(-1);
    expect(fns.lastIndexOf("constructPath")).toBe(cache);
    expect(lastText).toBeGreaterThan(cache);
    expect((await readPages(out))[0].text).toContain("Nouveau titre");
  });

  it("un cache blanc posé à la main masque ce qui a été ajouté avant lui", async () => {
    const annotations: Annotation[] = [
      text("a", "Texte ajouté", [50, 500], { fontSize: 14 }),
      { id: "w", pageId: "a", color: "#ffffff", opacity: 1, kind: "whiteout", rect: [45, 490, 200, 520], width: 0, fill: true },
    ];
    const fns = await operators(await exportPdf(await samplePdf(1), ["a"], annotations));
    // Le cache est dessiné après le texte ajouté : il le recouvre.
    expect(fns.lastIndexOf("constructPath")).toBeGreaterThan(fns.lastIndexOf("showText"));
  });
});

describe("texte surligné et barré", () => {
  it("dessine le fond avant le texte et le barré par-dessus", async () => {
    const annotations: Annotation[] = [text("a", "Important", [100, 600], { fontSize: 14, highlight: "#fff176", strike: true })];
    const out = await exportPdf(await samplePdf(1), ["a"], annotations);
    const fns = await operators(out);
    const firstPath = fns.indexOf("constructPath");
    const lastText = fns.lastIndexOf("showText");
    // Fond (tracé) avant le texte ajouté, barré (tracé) après.
    expect(firstPath).toBeGreaterThan(-1);
    expect(firstPath).toBeLessThan(lastText);
    expect(fns.lastIndexOf("constructPath")).toBeGreaterThan(lastText);
    expect((await readPages(out))[0].text).toContain("Important");
  });
});

describe("formes tournées et flèches courbes", () => {
  it("une forme tournée est dessinée avec une rotation autour de son centre", async () => {
    const annotations: Annotation[] = [{ id: "r", pageId: "a", color: "#0090ff", opacity: 1, kind: "rect", rect: [100, 400, 300, 500], width: 2, fill: false, angle: 30 }];
    const fns = await operators(await exportPdf(await samplePdf(1), ["a"], annotations));
    expect(fns).toContain("transform");
  });

  it("une flèche courbe est tracée en plusieurs segments", async () => {
    const straight: Annotation = { id: "l", pageId: "a", color: "#000000", opacity: 1, kind: "line", from: [100, 100], to: [300, 100], width: 2, arrow: true };
    const curved: Annotation = { ...straight, control: [200, 250] } as Annotation;
    const count = async (a: Annotation) => (await operators(await exportPdf(await samplePdf(1), ["a"], [a]))).filter((f) => f === "constructPath").length;
    expect(await count(curved)).toBeGreaterThan((await count(straight)) + 10);
  });
});

describe("modifications et opérations sur les pages", () => {
  it("les annotations suivent leur page après un déplacement", async () => {
    const moved = await ops.movePage(await samplePdf(3), ["a", "b", "c"], 0, 2);
    expect(moved.pageIds).toEqual(["b", "c", "a"]);
    const out = await exportPdf(moved.bytes, moved.pageIds, [text("a", "Note sur A", [50, 400]), text("c", "Note sur C", [50, 400])]);
    const pages = await readPages(out);
    expect(pages[0].text).not.toContain("Note");
    expect(pages[1].text).toContain("Page 3");
    expect(pages[1].text).toContain("Note sur C");
    expect(pages[2].text).toContain("Page 1");
    expect(pages[2].text).toContain("Note sur A");
  });

  it("n'écrit pas les annotations d'une page supprimée", async () => {
    const del = await ops.deletePages(await samplePdf(3), ["a", "b", "c"], new Set(["b"]));
    const out = await exportPdf(del.bytes, del.pageIds, [text("b", "Fantôme", [50, 400]), text("c", "Gardé", [50, 400])]);
    const pages = await readPages(out);
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.text).join(" ")).not.toContain("Fantôme");
    expect(pages[1].text).toContain("Gardé");
  });

  it("une page dupliquée reçoit ses propres annotations", async () => {
    const dup = await ops.duplicatePage(await samplePdf(1), ["a"], 0);
    expect(dup.pageIds).toHaveLength(2);
    const copyId = dup.pageIds[1];
    expect(copyId).not.toBe("a");
    const out = await exportPdf(dup.bytes, dup.pageIds, [text(copyId, "Sur la copie", [50, 400])]);
    const pages = await readPages(out);
    expect(pages.map((p) => p.text.includes("Page 1"))).toEqual([true, true]);
    expect(pages[0].text).not.toContain("Sur la copie");
    expect(pages[1].text).toContain("Sur la copie");
  });

  it("garde les annotations après une rotation de la page", async () => {
    const r = await ops.rotatePages(await samplePdf(2), ["a", "b"], new Set(["a"]), 90);
    const out = await exportPdf(r.bytes, r.pageIds, [text("a", "Toujours là", [50, 400])]);
    const pages = await readPages(out);
    expect([pages[0].w, pages[0].h]).toEqual([842, 595]);
    expect(pages[0].text).toContain("Toujours là");
  });
});

describe("enregistrements successifs", () => {
  it("un PDF déjà modifié peut être de nouveau modifié sans perte", async () => {
    const first = await exportPdf(await samplePdf(1), ["a"], [text("a", "Première passe", [50, 600])]);
    const second = await exportPdf(first, ["a"], [text("a", "Deuxième passe", [50, 500])]);
    const [page] = await readPages(second);
    expect(page.text).toContain("Page 1");
    expect(page.text).toContain("Première passe");
    expect(page.text).toContain("Deuxième passe");
    expect((await PDFDocument.load(second, { updateMetadata: false })).getProducer()).toBe("Paperasse PDF");
  });

  it("un export sans annotation conserve toutes les pages et leur texte", async () => {
    const out = await exportPdf(await samplePdf(3), ["a", "b", "c"], []);
    expect((await readPages(out)).map((p) => p.text)).toEqual(["Page 1", "Page 2", "Page 3"]);
  });
});

describe("images et signatures", () => {
  it("intègre l'image dans le contenu de la bonne page", async () => {
    const img: Annotation = { id: "i", pageId: "b", color: "#000000", opacity: 1, kind: "image", rect: [100, 100, 220, 160], dataUrl: PNG_DATA_URL };
    const out = await exportPdf(await samplePdf(2), ["a", "b"], [img]);
    expect(await operators(out, 1)).not.toContain("paintImageXObject");
    expect(await operators(out, 2)).toContain("paintImageXObject");
  });
});

describe("création de formulaires", () => {
  it("crée de vrais champs PDF, remplissables ensuite", async () => {
    const annotations: Annotation[] = [
      field("a", "nom", "text", 700),
      field("a", "commentaire", "text", 600, { multiline: true, fontSize: 10 }),
      field("a", "accord", "checkbox", 500),
      field("a", "ville", "dropdown", 400, { options: [" Paris ", "Lyon", ""] }),
    ];
    const out = await exportPdf(await samplePdf(1), ["a"], annotations);
    const fields = await readFormFields(out);
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ["nom", "text"],
      ["commentaire", "text"],
      ["accord", "checkbox"],
      ["ville", "choice"],
    ]);
    expect(fields.find((f) => f.name === "commentaire")).toMatchObject({ multiline: true });
    // Options nettoyées : espaces retirés, vides ignorés.
    expect(fields.find((f) => f.name === "ville")).toMatchObject({ options: ["Paris", "Lyon"] });

    const filled = await fillForm(out, { nom: "Durand", accord: true, ville: "Lyon" });
    const after = await readFormFields(filled);
    expect(after.find((f) => f.name === "nom")?.value).toBe("Durand");
    expect(after.find((f) => f.name === "accord")?.value).toBe(true);
    expect(after.find((f) => f.name === "ville")?.value).toBe("Lyon");
  });

  it("renomme un champ dont le nom existe déjà", async () => {
    const out = await exportPdf(await samplePdf(1), ["a"], [field("a", "nom", "text", 700), field("a", "nom", "text", 650), field("a", "mon champ.1", "text", 600)]);
    expect((await readFormFields(out)).map((f) => f.name)).toEqual(["nom", "nom_2", "mon_champ_1"]);
  });

  it("aplatit le formulaire à la demande en gardant les valeurs visibles", async () => {
    const withField = await exportPdf(await samplePdf(1), ["a"], [field("a", "nom", "text", 700)]);
    const filled = await fillForm(withField, { nom: "Martin" });
    const flat = await exportPdf(filled, ["a"], [], { flattenForms: true });
    expect(await readFormFields(flat)).toEqual([]);
    expect((await readPages(flat))[0].text).toContain("Martin");
  });
});

describe("remplissage de formulaires existants", () => {
  it("sélectionne un bouton radio et ignore les champs inconnus", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const radio = doc.getForm().createRadioGroup("civilite");
    radio.addOptionToPage("M.", page, { x: 50, y: 700, width: 16, height: 16 });
    radio.addOptionToPage("Mme", page, { x: 100, y: 700, width: 16, height: 16 });
    const filled = await fillForm(await doc.save(), { civilite: "Mme", inexistant: "x" });
    expect(await readFormFields(filled)).toEqual([
      { kind: "radio", name: "civilite", value: "Mme", options: ["M.", "Mme"], readOnly: false },
    ]);
  });

  it("décoche une case précédemment cochée", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const box = doc.getForm().createCheckBox("ok");
    box.addToPage(page, { x: 50, y: 700, width: 16, height: 16 });
    box.check();
    const filled = await fillForm(await doc.save(), { ok: false });
    expect((await readFormFields(filled))[0]).toMatchObject({ name: "ok", value: false });
  });
});

describe("duplication d'un élément", () => {
  it("décale la copie vers le bas à droite avec un nouvel identifiant", () => {
    const a = text("a", "Copie", [100, 100]);
    const copy = duplicateAnnotation(a) as TextAnnotation;
    expect(copy.id).not.toBe(a.id);
    expect(copy.origin).toEqual([112, 88]);
    expect(copy.text).toBe("Copie");
    expect(a.origin).toEqual([100, 100]);
  });
});
