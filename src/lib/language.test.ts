import { describe, expect, it } from "vitest";
import { detectLanguage, LANGUAGES, ocrChoices } from "./language";

describe("langue de l'utilisateur", () => {
  it("prend la première langue prise en charge du navigateur", () => {
    expect(detectLanguage(["fr-FR", "en-US"]).language.ocr).toBe("fra");
    expect(detectLanguage(["ja-JP", "de-CH", "fr"]).language.ocr).toBe("deu");
  });

  it("choisit le drapeau de l'anglais selon la région", () => {
    expect(detectLanguage(["en-US"]).flag).toBe("us");
    expect(detectLanguage(["en-GB"]).flag).toBe("gb");
    expect(detectLanguage(["en"]).flag).toBe("gb");
  });

  it("passe à l'anglais pour une langue non prise en charge", () => {
    expect(detectLanguage(["ja-JP"]).language.ocr).toBe("eng");
    expect(detectLanguage([]).flag).toBe("gb");
  });

  it("propose la langue de l'utilisateur en premier pour l'OCR", () => {
    const de = LANGUAGES.find((l) => l.ocr === "deu")!;
    const choices = ocrChoices(de).map((c) => c.value);
    expect(choices[0]).toBe("deu");
    expect(choices).toContain("fra+eng");
    expect(ocrChoices(LANGUAGES[0]).map((c) => c.value).slice(0, 3)).toEqual(["fra", "fra+eng", "eng"]);
  });
});
