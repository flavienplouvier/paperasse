import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  moveText,
  setFontAndSize,
  setTextRenderingMode,
  showText,
  type PDFFont,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { exportPdf } from "./exportPdf";
import { removeTextInRects } from "./removeText";
import type { Annotation, Rect, TextLine } from "./types";

/**
 * « Modifier le texte » doit réellement retirer le texte d'origine du fichier :
 * on relit le PDF produit avec pdf.js (texte extrait, positions, opérations de
 * dessin) pour le vérifier.
 */

const CARLITO = "node_modules/@expo-google-fonts/carlito/400Regular/Carlito_400Regular.ttf";

async function readItems(bytes: Uint8Array, pageNumber = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const items = (content.items as { str: string; transform: number[]; width: number }[])
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }));
  const list = await page.getOperatorList();
  const names = new Map<number, string>(Object.entries(pdfjs.OPS).map(([k, v]) => [v as number, k]));
  const ops = list.fnArray.map((f: number) => names.get(f) ?? String(f));
  return { text: items.map((i) => i.str).join(" "), items, ops };
}

/** Ligne de base d'un mot dans une ligne écrite à (x, y) avec `font` (comme pdf.js la donne). */
function wordLine(font: PDFFont, line: string, word: string, x: number, y: number, size: number): TextLine {
  const before = line.slice(0, line.indexOf(word));
  return { origin: [x + font.widthOfTextAtSize(before, size), y], angle: 0, width: font.widthOfTextAtSize(word, size), fontSize: size };
}

/** Cache de « Modifier le texte » sur une ligne d'origine. */
const cover = (pageId: string, line: TextLine, extra: Partial<Annotation> = {}): Annotation => {
  const [x, y] = line.origin;
  const rect: Rect = [x - 1, y - line.fontSize * 0.3, x + line.width + 1, y + line.fontSize];
  return { id: `c${line.origin.join()}`, pageId, kind: "whiteout", rect, color: "#ffffff", opacity: 1, width: 0, fill: true, removeText: line, ...extra } as Annotation;
};

const replacement = (pageId: string, text: string, origin: [number, number], size = 14): Annotation => ({
  id: `t${text}`,
  pageId,
  kind: "text",
  origin,
  text,
  fontKey: "std:Helvetica",
  fontSize: size,
  color: "#000000",
  opacity: 1,
  rotation: 0,
});

describe("suppression réelle du texte d'origine", () => {
  it("police standard sans largeurs : retire un mot au milieu de la ligne sans décaler la suite", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const line = "Montant total : 1250 euros TTC";
    page.drawText(line, { x: 72, y: 700, size: 14, font });
    page.drawText("Autre ligne intacte", { x: 72, y: 650, size: 14, font });
    const bytes = await doc.save();
    const before = await readItems(bytes);

    const zone = wordLine(font, line, "1250", 72, 700, 14);
    const out = await exportPdf(bytes, ["p"], [cover("p", zone), replacement("p", "1480", zone.origin)]);
    const after = await readItems(out);

    expect(after.text).not.toContain("1250");
    expect(after.text).toContain("1480");
    expect(after.text).toContain("Autre ligne intacte");
    // Le début et la fin de la ligne sont toujours là, à la même position.
    const lineBefore = before.items.find((i) => i.str.startsWith("Montant"))!;
    const lineAfter = after.items.find((i) => i.str.startsWith("Montant"))!;
    expect(lineAfter.x).toBeCloseTo(lineBefore.x, 2);
    expect(lineAfter.y).toBeCloseTo(lineBefore.y, 2);
    expect(after.text).toContain("euros TTC");
    // Aucun cache blanc dessiné : le texte est retiré, pas recouvert.
    expect(after.ops).not.toContain("constructPath");
  });

  it("garde la position exacte des caractères qui suivent le texte retiré", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const page = doc.addPage([595, 842]);
    const line = "ABCDEFGHIJ";
    page.drawText(line, { x: 100, y: 500, size: 20, font });
    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes);
    const [r] = removeTextInRects(loaded, loaded.getPage(0), [wordLine(font, line, "DEF", 100, 500, 20)]);
    expect(r).toEqual({ removed: 3, invisible: 0 });
    const { items } = await readItems(await loaded.save());
    expect(items.map((i) => i.str)).toEqual(["ABC", "GHIJ"]);
    // « GHIJ » commence exactement là où il était avant la suppression.
    expect(items[1].x).toBeCloseTo(100 + font.widthOfTextAtSize("ABCDEF", 20), 2);
    expect(items[1].width).toBeCloseTo(font.widthOfTextAtSize("GHIJ", 20), 1);
    expect((await readItems(bytes)).text).toBe("ABCDEFGHIJ");
  });

  it("police TrueType incorporée (Identity-H, tableau W)", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(readFileSync(CARLITO), { subset: true });
    const page = doc.addPage([595, 842]);
    const line = "IBAN FR76 3000 6000 0112 3456 7890 189";
    page.drawText(line, { x: 60, y: 600, size: 12, font });
    const bytes = await doc.save();

    const out = await exportPdf(bytes, ["p"], [cover("p", wordLine(font, line, "3456 7890", 60, 600, 12))]);
    const after = await readItems(out);
    expect(after.text).not.toMatch(/3456|7890/);
    expect(after.text).toContain("IBAN FR76 3000 6000 0112");
    expect(after.text).toContain("189");
    expect(after.ops).not.toContain("constructPath");
  });

  it("texte tourné (page pivotée de 90°)", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(90));
    // Texte écrit le long de l'axe Y du PDF (horizontal à l'écran).
    page.drawText("Secret", { x: 300, y: 200, size: 18, font, rotate: degrees(90) });
    page.drawText("Public", { x: 400, y: 200, size: 18, font, rotate: degrees(90) });
    const bytes = await doc.save();
    const line: TextLine = { origin: [300, 200], angle: 90, width: font.widthOfTextAtSize("Secret", 18), fontSize: 18 };
    const out = await exportPdf(bytes, ["p"], [cover("p", line)]);
    const after = await readItems(out);
    expect(after.text).not.toContain("Secret");
    expect(after.text).toContain("Public");
  });

  it("deux modifications successives de la même ligne ne laissent aucun cache", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText("Nom : Dupont", { x: 72, y: 700, size: 14, font });
    const bytes = await doc.save();
    const line = wordLine(font, "Nom : Dupont", "Nom : Dupont", 72, 700, 14);
    const out = await exportPdf(bytes, ["p"], [cover("p", line), cover("p", line, { id: "second" })]);
    const after = await readItems(out);
    expect(after.text).toBe("");
    expect(after.ops).not.toContain("constructPath");
  });

  it("texte invisible (couche OCR d'un scan) : retiré, mais le cache reste pour masquer l'image", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.pushOperators(
      beginText(),
      setFontAndSize(PDFName.of(page.node.newFontDictionary("F0", font.ref).decodeText()), 14),
      setTextRenderingMode(TextRenderingMode.Invisible),
      moveText(72, 700),
      showText(font.encodeText("Scanne")),
      endText(),
    );
    const bytes = await doc.save();
    const out = await exportPdf(bytes, ["p"], [cover("p", wordLine(font, "Scanne", "Scanne", 72, 700, 14))]);
    const after = await readItems(out);
    expect(after.text).not.toContain("Scanne");
    expect(after.ops).toContain("constructPath");
  });

  it("texte dans un XObject de formulaire : non retiré, le cache reste dessiné", async () => {
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    src.addPage([595, 842]).drawText("Dans un formulaire", { x: 72, y: 700, size: 14, font });
    const doc = await PDFDocument.create();
    const [embedded] = await doc.embedPdf(await src.save());
    doc.addPage([595, 842]).drawPage(embedded, { x: 0, y: 0 });
    const bytes = await doc.save();
    const out = await exportPdf(bytes, ["p"], [cover("p", wordLine(font, "Dans un formulaire", "Dans un formulaire", 72, 700, 14))]);
    expect((await readItems(out)).ops).toContain("constructPath");
  });

  it("flux écrit à la main : TJ avec crénage, ' et \", chaînes littérales échappées, image en ligne", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const fontName = page.node.newFontDictionary("F1", font.ref).decodeText();
    const content = [
      "q 1 0 0 1 0 0 cm",
      "BI /W 2 /H 1 /CS /G /BPC 8 ID \x00\xff EI",
      "Q",
      "BT",
      `/${fontName} 12 Tf 14 TL`,
      "72 700 Td",
      "[(Bon) -20 (jour)] TJ",
      "(\\(gard\\351\\)) '",
      "2 0 (Confidentiel) \"",
      "(Fin) '",
      "ET",
    ].join("\n");
    const stream = doc.context.flateStream(Uint8Array.from(content, (c) => c.charCodeAt(0)));
    page.node.set(PDFName.of("Contents"), doc.context.obj([doc.context.register(stream)]));
    const bytes = await doc.save();

    // « Confidentiel » est sur la 3e ligne (y = 700 - 2 × 14).
    const out = await exportPdf(bytes, ["p"], [cover("p", wordLine(font, "Confidentiel", "Confidentiel", 72, 672, 12))]);
    const after = await readItems(out);
    expect(after.text).not.toContain("Confidentiel");
    expect(after.text).toContain("Bon");
    expect(after.text).toContain("(gardé)");
    const fin = after.items.find((i) => i.str === "Fin")!;
    expect(fin.y).toBeCloseTo(658, 1);
    expect(fin.x).toBeCloseTo(72, 1);
  });

  it("lignes très serrées, petits caractères et texte décalé d'une demi-ligne : seule la ligne visée part", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    // Corps 2 pt, interligne 2,4 pt ; un renvoi décalé d'une demi-ligne au-dessus.
    page.drawText("ligne au-dessus", { x: 50, y: 402.4, size: 2, font });
    page.drawText("ligne visée", { x: 50, y: 400, size: 2, font });
    page.drawText("ligne dessous", { x: 50, y: 397.6, size: 2, font });
    page.drawText("demi", { x: 52, y: 401, size: 2, font });
    const bytes = await doc.save();
    const line = wordLine(font, "ligne visée", "ligne visée", 50, 400, 2);
    const out = await exportPdf(bytes, ["p"], [cover("p", line)]);
    const after = await readItems(out);
    expect(after.text).not.toContain("visée");
    for (const kept of ["ligne au-dessus", "ligne dessous", "demi"]) expect(after.text).toContain(kept);
  });

  it("texte en diagonale : les étiquettes voisines restent", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("Diagonale", { x: 100, y: 100, size: 12, font, rotate: degrees(45) });
    // Étiquettes horizontales dans la boîte englobante de la diagonale, hors de sa ligne.
    page.drawText("Coin", { x: 150, y: 110, size: 8, font });
    page.drawText("Haut", { x: 105, y: 150, size: 8, font });
    const bytes = await doc.save();
    const line: TextLine = { origin: [100, 100], angle: 45, width: font.widthOfTextAtSize("Diagonale", 12), fontSize: 12 };
    const after = await readItems(await exportPdf(bytes, ["p"], [cover("p", line)]));
    expect(after.text).not.toContain("Diagonale");
    expect(after.text).toContain("Coin");
    expect(after.text).toContain("Haut");
  });

  it("cache blanc dessiné à la main : le texte dessous est retiré et le cache reste visible", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const line = "IBAN FR76 3000 6000 0112 3456 7890 189";
    page.drawText(line, { x: 60, y: 600, size: 12, font });
    page.drawText("Texte hors du cache", { x: 60, y: 560, size: 12, font });
    const bytes = await doc.save();
    // Le cache couvre la fin de l'IBAN, à partir de « 3456 ».
    const x1 = 60 + font.widthOfTextAtSize("IBAN FR76 3000 6000 0112 ", 12) - 1;
    const manual: Annotation = { id: "m", pageId: "p", kind: "whiteout", rect: [x1, 595, 400, 612], color: "#ffffff", opacity: 1, width: 0, fill: true };
    const after = await readItems(await exportPdf(bytes, ["p"], [manual]));
    expect(after.text).not.toMatch(/3456|7890|189/);
    expect(after.text).toContain("IBAN FR76 3000 6000 0112");
    expect(after.text).toContain("Texte hors du cache");
    // Le rectangle blanc est toujours dessiné.
    expect(after.ops).toContain("constructPath");
  });

  it("cache blanc : un caractère à moitié sous le bord du cache reste (seul son centre compte)", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    doc.addPage([595, 842]).drawText("ABCDEF", { x: 100, y: 500, size: 20, font });
    const bytes = await doc.save();
    // Courier : 12 pt par caractère. Le cache commence au milieu de « C » + 1 pt : C reste, D E F partent.
    const manual: Annotation = { id: "m", pageId: "p", kind: "whiteout", rect: [100 + 24 + 7, 490, 300, 530], color: "#ffffff", opacity: 1, width: 0, fill: true };
    const after = await readItems(await exportPdf(bytes, ["p"], [manual]));
    expect(after.text).toBe("ABC");
  });

  it("ne touche pas la page quand rien n'est dans la zone", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("Rien ici", { x: 72, y: 700, size: 14, font });
    const loaded = await PDFDocument.load(await doc.save());
    const target = loaded.getPage(0);
    const contentsBefore = target.node.get(PDFName.of("Contents"));
    const elsewhere: TextLine = { origin: [300, 300], angle: 0, width: 100, fontSize: 14 };
    expect(removeTextInRects(loaded, target, [elsewhere])).toEqual([{ removed: 0, invisible: 0 }]);
    expect(target.node.get(PDFName.of("Contents"))).toBe(contentsBefore);
  });
});
