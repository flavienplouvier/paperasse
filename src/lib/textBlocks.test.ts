import { describe, expect, it } from "vitest";
import { blockAt, blocksOf, layoutText, type Piece } from "./textBlocks";

const piece = (str: string, x: number, y: number, width: number, fontSize = 18, fontName = "f1"): Piece => ({ str, baseline: [x, y], width, fontSize, fontName, angle: 0 });

// Titre d'un Cerfa : deux lignes écrites en dix morceaux (espaces placées à part).
const title: Piece[] = [
  piece("Récépissé de", 51, 703.5, 113.3),
  piece(" ", 164.3, 703.5, 0.3),
  piece("dépôt d’une demande de", 169.2, 703.5, 220),
  piece(" ", 389.2, 703.5, 0.3),
  piece("permis", 394.1, 703.5, 59.3),
  piece("de", 51, 683.5, 22.1),
  piece(" ", 73.2, 683.5, 0.3),
  piece("construire une maison individuelle et/ou ses", 78, 683.5, 383.6),
  piece(" ", 461.7, 683.5, 0.3),
  piece("annexes*", 466.5, 683.5, 80),
];

/** Paragraphe justifié, mot par mot, sans caractère espace. */
function justified(lines: string[][], x0: number, y0: number, width: number, size = 8): Piece[] {
  const out: Piece[] = [];
  lines.forEach((words, i) => {
    const y = y0 - i * size * 1.25;
    const wordW = words.map((w) => w.length * size * 0.5);
    const last = i === lines.length - 1;
    const gap = last ? size * 0.28 : (width - wordW.reduce((a, b) => a + b, 0)) / (words.length - 1);
    let x = x0;
    words.forEach((w, k) => {
      out.push(piece(w, x, y, wordW[k], size, "f4"));
      x += wordW[k] + gap;
    });
  });
  return out;
}

describe("blocs de texte", () => {
  it("recolle le titre en un seul bloc de deux lignes", () => {
    const blocks = blocksOf(title);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.lines.map((l) => l.text)).toEqual(["Récépissé de dépôt d’une demande de permis", "de construire une maison individuelle et/ou ses annexes*"]);
    expect(b.text).toBe("Récépissé de dépôt d’une demande de permis de construire une maison individuelle et/ou ses annexes*");
    expect(b.lineHeight).toBeCloseTo(20);
    expect(b.align).toBe("left");
    expect(b.left).toBe(51);
  });

  it("reconnaît un paragraphe justifié écrit mot par mot", () => {
    const para = justified(
      [
        ["Certains", "travaux", "ne", "peuvent", "pas", "être", "commencés"],
        ["dès", "la", "délivrance", "du", "permis", "et", "doivent"],
        ["être", "différés."],
      ],
      51,
      43.5,
      175,
    );
    const [b] = blocksOf(para);
    expect(b.lines).toHaveLength(3);
    expect(b.align).toBe("justify");
    expect(b.text.startsWith("Certains travaux ne peuvent")).toBe(true);
  });

  it("sépare deux paragraphes et deux colonnes", () => {
    const a = justified([["Premier", "paragraphe", "ici"]], 51, 500, 200);
    const b = justified([["Second", "paragraphe"]], 51, 470, 200); // grand écart vertical
    const c = justified([["Colonne", "droite"]], 400, 500, 120); // même ligne, loin à droite
    expect(blocksOf([...a, ...b, ...c])).toHaveLength(3);
  });

  it("trouve le bloc sous le pointeur", () => {
    const blocks = blocksOf(title);
    expect(blockAt(blocks, [300, 690])).toBe(blocks[0]);
    expect(blockAt(blocks, [300, 600])).toBeUndefined();
  });

  it("garde les retours à la ligne d'une liste et entre les phrases", () => {
    const size = 10;
    const lines = [
      ["de votre dossier, l’administration peut vous", 254],
      ["contacter :", 102],
      ["– soit pour vous avertir qu’un autre délai est", 245],
      ["applicable, lorsque le code l’a prévu ;", 284],
      ["– soit pour vous indiquer qu’il manque une pièce", 288],
    ] as const;
    const pieces = lines.map(([str, r], i) => piece(str, 51, 500 - i * 15, r - 51, size, "f3"));
    const [b] = blocksOf(pieces);
    expect(b.text).toBe(
      "de votre dossier, l’administration peut vous contacter :\n– soit pour vous avertir qu’un autre délai est applicable, lorsque le code l’a prévu ;\n– soit pour vous indiquer qu’il manque une pièce",
    );
  });

  it("centre un titre centré", () => {
    const centered = [piece("Un titre bien centré", 200, 700, 195), piece("court", 260, 680, 75)];
    expect(blocksOf(centered)[0].align).toBe("center");
  });
});

describe("mise en page", () => {
  const measure = (s: string) => s.length * 10;

  it("coupe aux espaces dans la largeur", () => {
    const lines = layoutText("un deux trois quatre", 100, "left", measure);
    expect(lines.map((l) => l.text)).toEqual(["un deux", "trois", "quatre"]);
  });

  it("justifie toutes les lignes sauf la dernière", () => {
    const lines = layoutText("aa bb cc dd", 60, "justify", measure);
    expect(lines.map((l) => l.text)).toEqual(["aa bb", "cc dd"]);
    expect(lines[0].wordSpacing).toBeCloseTo(10);
    expect(lines[1].wordSpacing).toBe(0);
  });

  it("centre et garde les retours à la ligne voulus", () => {
    const lines = layoutText("ab\ncd", 100, "center", measure);
    expect(lines).toEqual([
      { text: "ab", x: 40, wordSpacing: 0, width: 20 },
      { text: "cd", x: 40, wordSpacing: 0, width: 20 },
    ]);
  });

  it("coupe un mot plus large que la ligne", () => {
    expect(layoutText("abcdefghijkl", 50, "left", measure).map((l) => l.text)).toEqual(["abcde", "fghij", "kl"]);
  });
});
