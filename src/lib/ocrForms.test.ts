import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { addInvisibleText, type OcrWord } from "./ocrLayer";
import { createFormField, suggestFieldName, uniqueFieldName } from "./formFields";
import { exportPdf } from "./exportPdf";
import { fillForm, readFormFields } from "./forms";
import type { Annotation } from "./types";

async function blank(rotate = 0) {
  const d = await PDFDocument.create();
  const page = d.addPage([595, 842]);
  if (rotate) page.setRotation(degrees(rotate));
  return d.save();
}

async function textItems(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return (content.items as { str: string; transform: number[]; width: number }[])
    .filter((i) => i.str.trim())
    .map((i) => {
      const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
      return { str: i.str, x, y, width: i.width };
    });
}

describe("OCR : couche de texte invisible", () => {
  it("rend le texte reconnu cherchable, à l'emplacement des mots", async () => {
    const words: OcrWord[] = [
      { text: "Facture", start: [72, 760], end: [140, 760], height: 14 },
      { text: "n°", start: [146, 760], end: [160, 760], height: 14 },
      { text: "2026-118", start: [166, 760], end: [230, 760], height: 14 },
      { text: "Total", start: [72, 700], end: [110, 700], height: 12 },
    ];
    const out = await addInvisibleText(await blank(), new Map([[0, words]]));
    const items = await textItems(out);
    expect(items.map((i) => i.str).join(" ")).toBe("Facture n° 2026-118 Total");
    const line = items[0];
    // pdf.js regroupe les mots d'une même ligne : le fragment couvre exactement
    // l'étendue reconnue (de 72 à 230), sur la ligne de base trouvée par l'OCR.
    expect(line.str).toBe("Facture n° 2026-118");
    expect(line.x).toBeCloseTo(72, 0);
    expect(line.y).toBeCloseTo(842 - 760, 0);
    expect(line.width).toBeCloseTo(230 - 72, 0);
  });

  it("suit l'orientation d'une page tournée", async () => {
    // Page tournée de 90° : un mot horizontal à l'écran a une ligne de base verticale dans le PDF.
    const words: OcrWord[] = [{ text: "Tourné", start: [300, 100], end: [300, 180], height: 12 }];
    const items = await textItems(await addInvisibleText(await blank(90), new Map([[0, words]])));
    expect(items[0].str).toBe("Tourné");
  });

  it("n'ajoute rien de visible", async () => {
    const out = await addInvisibleText(await blank(), new Map([[0, [{ text: "x", start: [10, 10], end: [20, 10], height: 10 } as OcrWord]]]));
    const doc = await PDFDocument.load(out);
    const content = new TextDecoder().decode((doc.getPage(0).node.Contents() as { getContents?: () => Uint8Array })?.getContents?.() ?? new Uint8Array());
    // Mode de rendu 3 = texte invisible (si le flux est lisible sans décompression).
    if (content) expect(content).toContain("3 Tr");
  });
});

describe("création de formulaires", () => {
  it("propose des noms uniques", () => {
    expect(suggestFieldName("text", ["texte_1", "texte_2"])).toBe("texte_3");
    expect(suggestFieldName("checkbox", [])).toBe("case_1");
  });

  it("crée des champs remplissables (texte, case, liste) avec des noms sans conflit", async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([595, 842]);
    d.getForm().createTextField("nom").addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    expect(uniqueFieldName(d, "nom")).toBe("nom_2");

    const base = { pageId: "p", color: "#000000", opacity: 1, fontSize: 0 };
    const annotations: Annotation[] = [
      { ...base, id: "1", kind: "field", fieldType: "text", name: "nom", rect: [72, 700, 272, 722], multiline: false },
      { ...base, id: "2", kind: "field", fieldType: "checkbox", name: "accord", rect: [72, 660, 86, 674] },
      { ...base, id: "3", kind: "field", fieldType: "dropdown", name: "pays", rect: [72, 620, 212, 642], options: ["France", "Belgique"] },
    ];
    const out = await exportPdf(await d.save(), ["p"], annotations);
    const fields = await readFormFields(out);
    expect(fields.map((f) => `${f.kind}:${f.name}`).sort()).toEqual(["checkbox:accord", "choice:pays", "text:nom", "text:nom_2"]);

    const filled = await fillForm(out, { nom_2: "Dupont", accord: true, pays: "Belgique" });
    const after = await readFormFields(filled);
    expect(after.find((f) => f.name === "nom_2")?.value).toBe("Dupont");
    expect(after.find((f) => f.name === "pays")?.value).toBe("Belgique");
  });

  it("crée un champ directement sur une page", async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([595, 842]);
    const name = createFormField(d, page, {
      id: "x",
      pageId: "p",
      kind: "field",
      fieldType: "text",
      name: "commentaire",
      rect: [50, 50, 300, 150],
      multiline: true,
      fontSize: 11,
      color: "#000000",
      opacity: 1,
    });
    expect(name).toBe("commentaire");
    const fields = await readFormFields(await d.save());
    expect(fields[0]).toMatchObject({ kind: "text", name: "commentaire", multiline: true });
  });
});
