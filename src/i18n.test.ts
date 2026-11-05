import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setCatalogForTests, t, tn } from "./i18n";
// @ts-expect-error script Node sans types
import { extract } from "../scripts/i18n-extract.mjs";

const dir = join(__dirname, "locales");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("traduction", () => {
  afterEach(() => setCatalogForTests("fr", {}));

  it("remplace les variables et choisit le pluriel", () => {
    setCatalogForTests("en", { "{n} page": "{n} page", "{n} pages": "{n} pages", "Bonjour {nom}": "Hello {nom}" });
    expect(t("Bonjour {nom}", { nom: "Léa" })).toBe("Hello Léa");
    expect(tn("{n} page", "{n} pages", 1)).toBe("1 page");
    expect(tn("{n} page", "{n} pages", 3)).toBe("3 pages");
    expect(t("Phrase sans traduction")).toBe("Phrase sans traduction");
  });

  it("la liste des phrases est à jour (npm run i18n)", () => {
    const fr = JSON.parse(readFileSync(join(dir, "fr.json"), "utf8"));
    expect(Object.keys(fr).sort()).toEqual([...extract(join(__dirname))].sort());
  });

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "fr.json")) {
    it(`${file} : toutes les phrases sont traduites, variables comprises`, () => {
      const fr = JSON.parse(readFileSync(join(dir, "fr.json"), "utf8")) as Record<string, string>;
      const cat = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, string>;
      const missing = Object.keys(fr).filter((k) => !cat[k]?.trim());
      expect(missing).toEqual([]);
      const broken = Object.keys(fr).filter((k) => placeholders(k) !== placeholders(cat[k]));
      expect(broken).toEqual([]);
    });
  }
});
