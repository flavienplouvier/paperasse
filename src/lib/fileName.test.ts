import { describe, expect, it } from "vitest";
import { buildFileName, cleanBase, findDate, formatDate, isoDate, type NameOptions } from "./fileName";

const base: NameOptions = { base: "Facture EDF", date: "2026-11-05", format: "iso", position: "end", underscores: true };

describe("nom du fichier", () => {
  it("ajoute la date à la fin, espaces remplacés par défaut", () => {
    expect(buildFileName(base)).toBe("Facture_EDF_2026-11-05.pdf");
  });

  it("garde les espaces si on le demande", () => {
    expect(buildFileName({ ...base, underscores: false })).toBe("Facture EDF 2026-11-05.pdf");
  });

  it("met la date en tête", () => {
    expect(buildFileName({ ...base, position: "start" })).toBe("2026-11-05_Facture_EDF.pdf");
    expect(buildFileName({ ...base, position: "start", underscores: false })).toBe("2026-11-05 Facture EDF.pdf");
  });

  it("écrit la date à la française", () => {
    expect(formatDate("2026-11-05", "fr")).toBe("05-11-2026");
    expect(buildFileName({ ...base, format: "fr" })).toBe("Facture_EDF_05-11-2026.pdf");
  });

  it("sans date, seul le nom compte", () => {
    expect(buildFileName({ ...base, date: null })).toBe("Facture_EDF.pdf");
    expect(buildFileName({ ...base, base: "cerfa 13406.pdf", date: null, underscores: false })).toBe("cerfa 13406.pdf");
  });

  it("retire les caractères interdits et donne un nom par défaut", () => {
    expect(cleanBase('a/b:c*?"<>|d')).toBe("a-b-c-d");
    expect(buildFileName({ ...base, base: "   " })).toBe("Document_2026-11-05.pdf");
  });

  it("date du jour au format du champ date", () => {
    expect(isoDate(new Date(2026, 10, 5))).toBe("2026-11-05");
  });
});

describe("date déjà présente dans le nom", () => {
  it("trouve une date en fin de nom", () => {
    expect(findDate("Facture_EDF_2026-11-05.pdf")).toEqual({ date: "2026-11-05", format: "iso", position: "end", underscores: true, rest: "Facture_EDF" });
    expect(findDate("Facture EDF 05-11-2026")).toEqual({ date: "2026-11-05", format: "fr", position: "end", underscores: false, rest: "Facture EDF" });
  });

  it("trouve une date en tête de nom", () => {
    expect(findDate("2026-11-05_Facture")).toEqual({ date: "2026-11-05", format: "iso", position: "start", underscores: true, rest: "Facture" });
    expect(findDate("05.11.2026 - Relevé")).toMatchObject({ date: "2026-11-05", format: "fr", position: "start", rest: "Relevé" });
  });

  it("ignore ce qui n'est pas une date", () => {
    expect(findDate("cerfa_13406-16_PLOUVIER")).toBeNull();
    expect(findDate("Facture 2026-13-05")).toBeNull();
    expect(findDate("ref2026-11-05")).toBeNull();
    expect(findDate("Rapport")).toBeNull();
  });

  it("un nom qui n'est qu'une date", () => {
    expect(findDate("2026-11-05")).toMatchObject({ date: "2026-11-05", rest: "", position: "end" });
  });

  it("remplacer la date garde son format et sa place", () => {
    const f = findDate("05-11-2025_Facture EDF")!;
    expect(buildFileName({ base: f.rest, date: "2026-11-05", format: f.format, position: f.position, underscores: false })).toBe("05-11-2026 Facture EDF.pdf");
  });
});
