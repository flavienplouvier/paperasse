import { describe, expect, it } from "vitest";
import { boxAt, cornerPosition, exportSignItems, freeSpot, layoutParts, parseSignItems, sortForStack, type Box, type PlacePart, type SignItem } from "./signatures";

const items: SignItem[] = [
  { id: "a", kind: "identity", createdAt: 1, text: "Léa Martin", city: "Lyon", withDate: true },
  { id: "b", kind: "signature", createdAt: 2, dataUrl: "data:image/png;base64,AAAA" },
  { id: "c", kind: "mention", createdAt: 3, text: "Lu et approuvé" },
];

describe("signatures enregistrées", () => {
  it("se sauvegardent dans un fichier et se relisent", () => {
    expect(parseSignItems(exportSignItems(items))).toEqual(items);
  });

  it("refuse un fichier qui n'est pas une sauvegarde", () => {
    expect(parseSignItems("{}")).toBeNull();
    expect(parseSignItems("pas du json")).toBeNull();
    const bad = JSON.stringify({ format: "paperasse-signatures", version: 1, items: [{ id: "x", kind: "signature", createdAt: 1, dataUrl: "javascript:alert(1)" }] });
    expect(parseSignItems(bad)).toEqual([]);
  });

  it("s'empilent dans l'ordre mention, signature, identité", () => {
    expect(sortForStack(items).map((i) => i.kind)).toEqual(["mention", "signature", "identity"]);
  });
});

describe("pose sur la page", () => {
  const parts: PlacePart[] = [
    { type: "text", text: "Lu et approuvé", fontKey: "lib:caveat:regular", fontSize: 16, color: "#1a2b6d" },
    { type: "image", dataUrl: "data:image/png;base64,AAAA", width: 160, height: 60 },
    { type: "text", text: "Léa Martin\nFait à Lyon, le 05/11/2026", fontKey: "std:Helvetica", fontSize: 11, color: "#000" },
  ];

  it("empile de haut en bas, alignés à gauche, centrés sur le point touché", () => {
    const [mention, signature, identity] = layoutParts(parts, [300, 400], 0);
    if (mention.type !== "text" || signature.type !== "image" || identity.type !== "text") throw new Error("ordre");
    // Bloc : 20 (mention) + 6 + 60 + 6 + 27.5 (2 lignes) = 119.5 de haut, 160 de large.
    expect(mention.origin[0]).toBeCloseTo(220);
    expect(signature.rect[0]).toBeCloseTo(220);
    expect(signature.rect[2] - signature.rect[0]).toBeCloseTo(160);
    // Chaque élément est sous le précédent (y diminue vers le bas en PDF).
    expect(signature.rect[3]).toBeLessThan(mention.origin[1]);
    expect(identity.origin[1]).toBeLessThan(signature.rect[1]);
    // Centré verticalement sur le point touché.
    expect(mention.origin[1] + 16 - 119.5 / 2).toBeCloseTo(400);
  });

  it("pose plusieurs paraphes côte à côte", () => {
    const img = (w: number) => ({ type: "image" as const, dataUrl: "data:image/png;base64,AAAA", width: w, height: 30 });
    const placed = layoutParts([{ type: "row", parts: [img(60), img(60)] }], [300, 400], 0);
    expect(placed).toHaveLength(2);
    const [a, b] = placed.map((p) => (p.type === "image" ? p.rect : [0, 0, 0, 0]));
    // Même hauteur, la seconde à droite de la première, 6 pt d'écart ; rangée centrée sur le point.
    expect(a[1]).toBeCloseTo(b[1]);
    expect(b[0] - a[2]).toBeCloseTo(6);
    expect((a[0] + b[2]) / 2).toBeCloseTo(300);
  });

  it("une image seule est centrée exactement sur le point (sans largeur minimale)", () => {
    const [p] = layoutParts([{ type: "image", dataUrl: "data:image/png;base64,AAAA", width: 60, height: 20 }], [100, 100], 0);
    if (p.type !== "image") throw new Error("image");
    expect(p.rect).toEqual([70, 90, 130, 110]);
  });

  it("suit la rotation de la page", () => {
    const [, signature] = layoutParts(parts, [300, 400], 90);
    if (signature.type !== "image") throw new Error("image");
    // Page tournée : la largeur affichée devient la hauteur en coordonnées PDF.
    expect(signature.rect[3] - signature.rect[1]).toBeCloseTo(160);
  });
});

describe("paraphes sur toutes les pages", () => {
  const page = { width: 595, height: 842 };

  it("garde la place demandée quand elle est libre", () => {
    expect(freeSpot([500, 780, 560, 810], [], page, "left")).toEqual([500, 780, 560, 810]);
  });

  it("se pose à côté d'une paraphe déjà présente", () => {
    const existing: Box = [500, 780, 560, 810];
    const b = freeSpot([500, 780, 560, 810], [existing], page, "left");
    expect(b[2]).toBeLessThanOrEqual(existing[0] - 6);
    expect(b[1]).toBe(780);
  });

  it("change de sens si la page s'arrête, puis monte", () => {
    // Collée au bord gauche : impossible d'aller à gauche, elle passe à droite de l'obstacle.
    expect(freeSpot([10, 780, 70, 810], [[0, 770, 80, 820]], page, "left")[0]).toBeGreaterThanOrEqual(86);
    // Toute la largeur est prise : elle monte au-dessus.
    const up = freeSpot([300, 780, 360, 810], [[0, 770, 595, 820]], page, "left");
    expect(up[3]).toBeLessThanOrEqual(764);
  });

  it("calcule les coins et ramène le cadre dans la page", () => {
    const pos = cornerPosition("right", 60, 30, page);
    expect(boxAt(pos, 60, 30, page)).toEqual([507, 784, 567, 814]);
    expect(boxAt({ fx: 1.2, fy: -1 }, 60, 30, page)).toEqual([535, 0, 595, 30]);
  });
});
