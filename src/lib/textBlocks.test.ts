import { describe, expect, it } from "vitest";
import type { Rule } from "./rules";
import { blockAt, blocksOf, layoutText, reflowText, shiftStyles, stylesFromFonts, type Piece } from "./textBlocks";

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
    // Le bloc s'ouvre tel quel : une ligne d'origine = une ligne du texte.
    expect(b.text).toBe("Récépissé de dépôt d’une demande de permis\nde construire une maison individuelle et/ou ses annexes*");
    expect(b.lineHeight).toBeCloseTo(20);
    // Écart réel entre les mots du PDF (≈ 4,9 pt), même sans les morceaux « espace ».
    expect(b.space).toBeCloseTo(4.9, 1);
    expect(blocksOf(title.filter((p) => p.str.trim()))[0].space).toBeCloseTo(4.9, 1);
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

  it("une espace très large (tabulation) sépare deux colonnes", () => {
    const row = [piece("PAIEMENT :", 20.6, 338.7, 68.2, 12), piece(" ", 88.8, 338.7, 321.9, 12), piece("TOTAL H.T.", 410.7, 340.9, 64, 12)];
    expect(blocksOf(row).map((b) => b.text).sort()).toEqual(["PAIEMENT :", "TOTAL H.T."]);
  });

  it("une bordure de tableau sépare l'étiquette du montant", () => {
    const row = [piece("TOTAL T.T.C.", 388.4, 297.4, 86.1, 14, "f4"), piece(" ", 474.5, 297.4, 9.1, 14, "f4"), piece("25615.20 €", 483.6, 297.1, 63.5, 14, "f5")];
    expect(blocksOf(row)).toHaveLength(1);
    const border: Rule = { x1: 476, y1: 280, x2: 477, y2: 315, vertical: true };
    expect(blocksOf(row, [border]).map((b) => b.text).sort()).toEqual(["25615.20 €", "TOTAL T.T.C."]);
  });

  it("un filet horizontal sépare deux lignes", () => {
    const rows = [piece("Total", 51, 500, 30, 10), piece("TVA", 51, 486, 20, 10)];
    expect(blocksOf(rows)).toHaveLength(1);
    expect(blocksOf(rows, [{ x1: 40, y1: 495, x2: 200, y2: 495.8, vertical: false }])).toHaveLength(2);
    // Un soulignement juste sous la ligne ne coupe pas le bloc.
    expect(blocksOf(rows, [{ x1: 51, y1: 498.6, x2: 81, y2: 499.2, vertical: false }])).toHaveLength(1);
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
    // Recollées à la demande : seules les lignes d'un même paragraphe se rejoignent.
    expect(reflowText(b.text)).toBe(
      "de votre dossier, l’administration peut vous contacter :\n– soit pour vous avertir qu’un autre délai est applicable, lorsque le code l’a prévu ;\n– soit pour vous indiquer qu’il manque une pièce",
    );
  });

  it("garde chaque entrée d'un sommaire numéroté sur sa ligne", () => {
    const toc = ["13.1 – Rachats exceptionnels", "13.2 – Garantie en cas de décès", "13.3 – Garantie plancher"].map((str, i) => piece(str, 51, 500 - i * 14, 150, 10, "f1"));
    expect(blocksOf(toc)[0].text.split("\n")).toHaveLength(3);
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

  it("garde les lignes d'origine ; seule une ligne trop longue se coupe", () => {
    const lines = layoutText("aa bb cc\ndd ee", 60, "left", measure);
    expect(lines.map((l) => l.text)).toEqual(["aa bb", "cc", "dd ee"]);
  });

  it("justifie une ligne d'origine qui continue le paragraphe", () => {
    const lines = layoutText("aa bb\ncc dd.", 60, "justify", measure);
    expect(lines[0].wordSpacing).toBeCloseTo(10);
    expect(lines[1].wordSpacing).toBe(0);
  });

  it("une ligne d'origine non modifiée reste à sa place et à sa largeur", () => {
    const original = [
      { text: "aa bb", x: 7, w: 62 },
      { text: "cc", x: 20, w: 20 },
    ];
    const lines = layoutText("aa bb\ncc dd", 80, "center", measure, original);
    // 1re ligne intacte : position et largeur d'origine, l'écart est réparti sur l'espace.
    expect(lines[0]).toMatchObject({ x: 7, width: 62, wordSpacing: 12 });
    // 2e ligne modifiée : recentrée normalement.
    expect(lines[1]).toMatchObject({ text: "cc dd", x: 15, wordSpacing: 0 });
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
      { text: "ab", start: 0, x: 40, wordSpacing: 0, width: 20 },
      { text: "cd", start: 3, x: 40, wordSpacing: 0, width: 20 },
    ]);
  });

  it("coupe un mot plus large que la ligne", () => {
    expect(layoutText("abcdefghijkl", 50, "left", measure).map((l) => l.text)).toEqual(["abcde", "fghij", "kl"]);
  });
});

describe("styles mélangés", () => {
  it("garde la police de chaque caractère (gras, symbole)", () => {
    const pieces = [piece("→", 51, 500, 10, 10, "f1"), piece(" Toutefois,", 61, 500, 50, 10, "f5"), piece("dans le mois", 115, 500, 55, 10, "f3")];
    const [b] = blocksOf(pieces);
    expect(b.text).toBe("→ Toutefois, dans le mois");
    expect(b.fonts.length).toBe(b.text.length);
    expect(b.fonts[0]).toBe("f1");
    expect(b.fonts[b.text.indexOf("T")]).toBe("f5");
    expect(b.fonts[b.text.indexOf("m")]).toBe("f3");
    const { styles, names } = stylesFromFonts(b.fonts, "f3");
    expect(names).toEqual(["f1", "f5"]);
    expect(styles[0]).toEqual({ start: 0, end: 1, font: 0 });
  });

  it("suit les modifications : le texte inséré prend le style voisin", () => {
    // « ab » en gras (police 0), « cd » normal.
    const styles = [{ start: 0, end: 2, font: 0 }];
    expect(shiftStyles(styles, "abcd", "abXcd")).toEqual([{ start: 0, end: 3, font: 0 }]);
    expect(shiftStyles(styles, "abcd", "Xabcd")).toEqual([{ start: 0, end: 3, font: 0 }]);
    expect(shiftStyles(styles, "abcd", "acd")).toEqual([{ start: 0, end: 1, font: 0 }]);
    expect(shiftStyles(styles, "abcd", "abcdY")).toEqual([{ start: 0, end: 2, font: 0 }]);
    // Remplacer le texte gras garde le gras (ex. un montant retapé).
    const total = [{ start: 6, end: 10, font: 0 }];
    expect(shiftStyles(total, "TOTAL 2561 €", "TOTAL 30978 €")).toEqual([{ start: 6, end: 11, font: 0 }]);
  });

  it("mesure chaque mot à sa position dans le texte", () => {
    const seen: number[] = [];
    layoutText("aa bb", 100, "left", (s, at) => (seen.push(at), s.length * 10));
    expect(seen).toContain(3);
  });
});
