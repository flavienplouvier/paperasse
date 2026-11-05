import { describe, expect, it } from "vitest";
import { exportSignItems, layoutParts, parseSignItems, sortForStack, type PlacePart, type SignItem } from "./signatures";

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

  it("suit la rotation de la page", () => {
    const [, signature] = layoutParts(parts, [300, 400], 90);
    if (signature.type !== "image") throw new Error("image");
    // Page tournée : la largeur affichée devient la hauteur en coordonnées PDF.
    expect(signature.rect[3] - signature.rect[1]).toBeCloseTo(160);
  });
});
