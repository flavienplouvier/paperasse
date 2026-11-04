import { beforeEach, describe, expect, it } from "vitest";
import { PICKED_MAX, addPickedColor, loadPickedColors, toHex } from "./pickedColors";

describe("couleurs prises à la pipette", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
  });

  it("garde les 7 dernières, la plus récente d'abord, sans doublon", () => {
    let list = loadPickedColors();
    expect(list).toEqual([]);
    list = addPickedColor(list, "#AABBCC");
    list = addPickedColor(list, "#112233");
    list = addPickedColor(list, "#aabbcc");
    expect(list).toEqual(["#aabbcc", "#112233"]);
    for (let i = 0; i < 10; i++) list = addPickedColor(list, `#0000${i.toString(16).padStart(2, "0")}`);
    expect(PICKED_MAX).toBe(7);
    expect(list).toHaveLength(7);
    expect(list[0]).toBe("#000009");
  });

  it("les retrouve au rechargement de l'application", () => {
    addPickedColor(addPickedColor([], "#123456"), "#654321");
    expect(loadPickedColors()).toEqual(["#654321", "#123456"]);
  });

  it("normalise les couleurs de la pipette native", () => {
    expect(toHex("#AbC123")).toBe("#abc123");
    expect(toHex("rgb(26, 43, 109)")).toBe("#1a2b6d");
    expect(toHex("rgba(255,0,0,0.5)")).toBe("#ff0000");
    expect(toHex("bleu")).toBeNull();
  });
});
