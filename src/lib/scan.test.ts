import { describe, expect, it } from "vitest";
import {
  defaultQuad,
  detectDocument,
  enhance,
  homography,
  orderQuad,
  outputSize,
  rotate90,
  scanFileName,
  splitScanFileName,
  warp,
  type Pixels,
  type Point,
  type Quad,
} from "./scan";

function blank(width: number, height: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { data, width, height };
}

const inside = (q: Point[], x: number, y: number) => {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c !== 0) {
      if (s === 0) s = Math.sign(c);
      else if (Math.sign(c) !== s) return false;
    }
  }
  return true;
};

/** Photo simulée : feuille claire inclinée sur une table sombre, avec du texte et une ombre. */
function photo(q: Quad, width = 800, height = 1000): Pixels {
  const img = blank(width, height, [70, 55, 45]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(q, x, y)) continue;
      const shade = 1 - 0.35 * (x / width); // ombre qui s'assombrit vers la droite
      const ink = y % 40 < 6 && x % 90 < 70; // lignes de « texte »
      const v = (ink ? 40 : 235) * shade;
      const i = (y * width + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v * 0.98;
      img.data[i + 2] = v * 0.9;
    }
  }
  return img;
}

const near = (a: Point, b: Point, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe("détection de la feuille", () => {
  it("retrouve les quatre coins d'une feuille inclinée", () => {
    const q: Quad = [
      { x: 140, y: 110 },
      { x: 660, y: 170 },
      { x: 610, y: 900 },
      { x: 90, y: 840 },
    ];
    const found = detectDocument(photo(q));
    expect(found).not.toBeNull();
    found!.forEach((p, i) => expect(near(p, q[i], 20)).toBe(true));
  });

  it("ne détecte rien sur une image uniforme", () => {
    expect(detectDocument(blank(400, 500, [200, 200, 200]))).toBeNull();
  });

  it("ordonne les coins quel que soit l'ordre d'entrée", () => {
    const q = orderQuad([
      { x: 10, y: 90 },
      { x: 95, y: 5 },
      { x: 5, y: 10 },
      { x: 90, y: 95 },
    ]);
    expect(q.map((p) => [p.x, p.y])).toEqual([
      [5, 10],
      [95, 5],
      [90, 95],
      [10, 90],
    ]);
  });

  it("propose toute la photo avec une marge à défaut", () => {
    expect(defaultQuad(100, 200, 0.1)).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 180 },
      { x: 10, y: 180 },
    ]);
  });
});

describe("redressement", () => {
  it("l'homographie envoie les coins du rectangle sur ceux du quadrilatère", () => {
    const q: Quad = [
      { x: 12, y: 30 },
      { x: 410, y: 4 },
      { x: 380, y: 590 },
      { x: 40, y: 520 },
    ];
    const [a, b, c, d, e, f, g, h] = homography(200, 300, q);
    const map = (x: number, y: number) => {
      const den = g * x + h * y + 1;
      return { x: (a * x + b * y + c) / den, y: (d * x + e * y + f) / den };
    };
    [map(0, 0), map(200, 0), map(200, 300), map(0, 300)].forEach((p, i) => expect(near(p, q[i], 1e-6)).toBe(true));
  });

  it("une feuille en perspective redevient rectangulaire", () => {
    const q: Quad = [
      { x: 140, y: 110 },
      { x: 660, y: 170 },
      { x: 610, y: 900 },
      { x: 90, y: 840 },
    ];
    const size = outputSize(q);
    const page = warp(photo(q), q, size.width, size.height);
    // Les quatre coins (légèrement en retrait) sont du papier, pas la table.
    for (const [x, y] of [
      [4, 4],
      [size.width - 5, 4],
      [size.width - 5, size.height - 5],
      [4, size.height - 5],
    ]) {
      const i = (y * size.width + x) * 4;
      expect(page.data[i] - page.data[i + 2]).toBeLessThan(30); // pas la teinte brune du fond
    }
    expect(size.height / size.width).toBeGreaterThan(1.3);
  });

  it("plafonne la taille de sortie", () => {
    const s = outputSize(defaultQuad(4000, 6000, 0), 2200);
    expect(Math.max(s.width, s.height)).toBe(2200);
  });

  it("tourne d'un quart de tour", () => {
    const img = blank(3, 2, [0, 0, 0]);
    img.data[0] = 255; // pixel rouge en haut à gauche
    const r = rotate90(img, 1);
    expect([r.width, r.height]).toEqual([2, 3]);
    expect(r.data[(0 * 2 + 1) * 4]).toBe(255); // en haut à droite après rotation horaire
  });
});

describe("nettoyage", () => {
  const q = defaultQuad(800, 1000, 0);
  const page = photo(q);
  const at = (img: Pixels, x: number, y: number) => img.data[(y * img.width + x) * 4];

  it("efface l'ombre : le papier devient blanc partout", () => {
    const out = enhance(page, "auto");
    expect(at(page, 780, 20) - at(page, 20, 20)).toBeLessThan(-50); // ombre bien présente avant
    expect(at(out, 20, 20)).toBeGreaterThan(240);
    expect(at(out, 780, 20)).toBeGreaterThan(240);
  });

  it("garde le texte sombre", () => {
    for (const f of ["auto", "gray", "bw"] as const) {
      const out = enhance(page, f);
      expect(at(out, 30, 402)).toBeLessThan(60);
      expect(at(out, 750, 402)).toBeLessThan(60);
    }
  });

  it("noir et blanc ne produit que du gris neutre", () => {
    const out = enhance(page, "bw");
    const i = (500 * 800 + 300) * 4;
    expect(out.data[i]).toBe(out.data[i + 1]);
    expect(out.data[i]).toBe(out.data[i + 2]);
  });

  it("« original » ne touche à rien", () => {
    expect(enhance(page, "original")).toBe(page);
  });
});

describe("nom du fichier scanné", () => {
  it("ajoute la date au nom", () => {
    expect(scanFileName("Facture EDF", "2026-11-05")).toBe("Facture EDF_2026-11-05.pdf");
    expect(scanFileName("Facture EDF.pdf", null)).toBe("Facture EDF.pdf");
  });

  it("retire les caractères interdits et donne un nom par défaut", () => {
    expect(scanFileName('a/b:c*?"<>|d', null)).toBe("a-b-c-d.pdf");
    expect(scanFileName("   ", "2026-01-02")).toBe("Scan_2026-01-02.pdf");
  });

  it("retrouve le nom et la date", () => {
    expect(splitScanFileName("Facture EDF_2026-11-05.pdf")).toEqual({ base: "Facture EDF", date: "2026-11-05" });
    expect(splitScanFileName("Scan.pdf")).toEqual({ base: "Scan", date: null });
  });
});
