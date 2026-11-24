import { describe, expect, it } from "vitest";
import { parsePageRanges } from "./pageRanges";

describe("pages à enregistrer (comme à l'impression)", () => {
  it("pages séparées et intervalles", () => {
    expect(parsePageRanges("1,3", 5)).toEqual([1, 3]);
    expect(parsePageRanges("1-3", 5)).toEqual([1, 2, 3]);
    expect(parsePageRanges(" 1 - 2 ; 5 ", 5)).toEqual([1, 2, 5]);
    expect(parsePageRanges("4-", 5)).toEqual([4, 5]);
    expect(parsePageRanges("-2", 5)).toEqual([1, 2]);
    expect(parsePageRanges("2–3", 5)).toEqual([2, 3]);
  });

  it("ordre du document, sans doublon", () => expect(parsePageRanges("5,1-3,2", 5)).toEqual([1, 2, 3, 5]));

  it("saisies invalides", () => {
    for (const s of ["", " , ", "0", "6", "3-1", "1-9", "a", "1.5", "-", "1--2", "2 3"]) expect(parsePageRanges(s, 5)).toBeNull();
  });
});
