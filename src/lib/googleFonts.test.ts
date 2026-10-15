import { describe, expect, it } from "vitest";
// @ts-expect-error module JavaScript des scripts de génération
import { buildCatalog, displayName } from "../../scripts/lib/google-fonts.mjs";
import { getFonts, matchFont, registerGoogleCatalog, styleVariant, type GoogleRow } from "./fonts";

describe("catalogue Google Fonts", () => {
  it("dérive des noms de famille lisibles", () => {
    expect(displayName("OpenSans")).toBe("Open Sans");
    expect(displayName("IBMPlexSans")).toBe("IBM Plex Sans");
    expect(displayName("PTSerif")).toBe("PT Serif");
    expect(displayName("Exo2")).toBe("Exo 2");
  });

  it("privilégie les fichiers statiques, puis les polices variables, et écarte le reste", () => {
    const catalog = buildCatalog(
      [
        "ofl/lato/Lato-Regular.ttf",
        "ofl/lato/Lato-Bold.ttf",
        "ofl/lato/Lato-Italic.ttf",
        "ofl/lato/Lato-BoldItalic.ttf",
        "ofl/lato/Lato-Thin.ttf",
        "ofl/montserrat/Montserrat[wght].ttf",
        "ofl/montserrat/Montserrat-Italic[wght].ttf",
        "ofl/inter/Inter[opsz,wght].ttf",
        "ofl/inter/static/Inter-Regular.ttf",
        "ofl/inter/static/Inter-Bold.ttf",
        "apache/chewy/Chewy-Regular.ttf",
        "ufl/ubuntu/Ubuntu-Regular.ttf",
        "ofl/notocoloremoji/NotoColorEmoji-Regular.ttf",
        "ofl/carlito/Carlito-Regular.ttf",
        "ofl/lato/METADATA.pb",
      ],
      ["carlito"],
    );
    const byId = Object.fromEntries(catalog.map((f: { id: string }) => [f.id, f]));
    expect(Object.keys(byId).sort()).toEqual(["chewy", "inter", "lato", "montserrat"]);
    expect(byId.lato.styles).toEqual({
      regular: "Lato-Regular.ttf",
      bold: "Lato-Bold.ttf",
      italic: "Lato-Italic.ttf",
      boldItalic: "Lato-BoldItalic.ttf",
    });
    expect(byId.montserrat).toMatchObject({ variable: true, styles: { regular: "Montserrat[wght].ttf", italic: "Montserrat-Italic[wght].ttf" } });
    expect(byId.inter.styles).toEqual({ regular: "static/Inter-Regular.ttf", bold: "static/Inter-Bold.ttf" });
    expect(byId.chewy).toMatchObject({ family: "Chewy", license: "apache" });
  });

  it("enregistre le catalogue et le rend utilisable (recherche, gras, correspondance)", () => {
    const rows: GoogleRow[] = [
      ["abel", "Abel", "ofl", 0, "Abel-Regular.ttf", "", "", ""],
      ["sourcesanspro", "Source Sans Pro", "ofl", 0, "SourceSansPro-Regular.ttf", "SourceSansPro-Bold.ttf", "", ""],
    ];
    registerGoogleCatalog("abc123", rows);
    const abel = getFonts().find((f) => f.key === "gf:abel:regular");
    expect(abel).toMatchObject({ label: "Abel", category: "google", source: "library" });
    expect(styleVariant("gf:sourcesanspro:regular", true, false)).toBe("gf:sourcesanspro:bold");
    // Un PDF utilisant « Abel » (non incorporée) retrouve la police du catalogue.
    expect(matchFont("ABCDEF+Abel-Regular")).toBe("gf:abel:regular");
  });
});
