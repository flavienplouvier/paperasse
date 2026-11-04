import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEJAVU_URL, FONTSOURCE_URL, documentFontFor, fontWeight, restoreDocumentFont } from "./documentFonts";
import { exportPdf } from "./exportPdf";
import { getFont, type FontEntry } from "./fonts";

/** Familles libres connues (comme la bibliothèque et le catalogue en contiennent). */
const lib = (family: string, category = "sans"): FontEntry => ({
  key: `lib:${family}`,
  label: family,
  source: "library",
  cssFamily: "x",
  family,
  slug: family.toLowerCase(),
  category,
});
const catalog = [lib("Montserrat"), lib("Poppins"), lib("Open Sans"), lib("Atkinson Hyperlegible", "google")];

describe("graisse d'un nom de police PDF", () => {
  it("reconnaît les graisses courantes et l'italique", () => {
    expect(fontWeight("ABCDEF+Montserrat-SemiBold")).toEqual({ weight: 600, italic: false });
    expect(fontWeight("Poppins-LightItalic")).toEqual({ weight: 300, italic: true });
    expect(fontWeight("Raleway-Medium")).toEqual({ weight: 500, italic: false });
    expect(fontWeight("Nunito-ExtraBold")).toEqual({ weight: 800, italic: false });
    expect(fontWeight("Lato-Black")).toEqual({ weight: 900, italic: false });
    expect(fontWeight("Inter-ExtraLight")).toEqual({ weight: 200, italic: false });
    expect(fontWeight("Inter-Thin")).toEqual({ weight: 100, italic: false });
    expect(fontWeight("OpenSans-Bold")).toEqual({ weight: 700, italic: false });
    expect(fontWeight("MontserratSemiBold")).toEqual({ weight: 600, italic: false });
    expect(fontWeight("Calibri,Bold")).toEqual({ weight: 700, italic: false });
    expect(fontWeight("Roboto")).toEqual({ weight: 400, italic: false });
    expect(fontWeight("Roboto", { bold: true, italic: true })).toEqual({ weight: 700, italic: true });
  });
});

describe("police complète du document", () => {
  it("police libre à une graisse intermédiaire : fichier Fontsource de cette graisse", () => {
    const key = documentFontFor("ABCDEF+Montserrat-SemiBold", {}, catalog)!;
    expect(key).toContain(`${FONTSOURCE_URL}montserrat@latest/latin-600-normal.ttf`);
    expect(getFont(key)).toMatchObject({ family: "Montserrat", bold: true, italic: false });
    expect(documentFontFor("Poppins-LightItalic", {}, catalog)).toContain("poppins@latest/latin-300-italic.ttf");
    expect(documentFontFor("AtkinsonHyperlegible-Medium", {}, catalog)).toContain("atkinson-hyperlegible@latest/latin-500-normal.ttf");
  });

  it("Regular et Bold restent servis par la bibliothèque (déjà complète)", () => {
    expect(documentFontFor("Montserrat-Regular", {}, catalog)).toBeNull();
    expect(documentFontFor("OpenSans-Bold", {}, catalog)).toBeNull();
  });

  it("DejaVu : fichier officiel du même nom", () => {
    const key = documentFontFor("QWERTY+DejaVuSans-Bold", {}, catalog)!;
    expect(key).toContain(`${DEJAVU_URL}DejaVuSans-Bold.ttf`);
    expect(getFont(key)).toMatchObject({ family: "DejaVu Sans", bold: true });
    expect(documentFontFor("DejaVuSerif-Italic", {}, catalog)).toContain("DejaVuSerif-Italic.ttf");
    expect(documentFontFor("DejaVuSansMono", {}, catalog)).toContain("DejaVuSansMono.ttf");
  });

  it("Marianne : serveur officiel (documents de l'État)", () => {
    expect(documentFontFor("SNKBLT+Marianne-Regular", {}, catalog)).toBe("etat:Marianne-Regular");
  });

  it("aucune source pour les polices commerciales ou inconnues", () => {
    for (const name of ["ArialMT", "Calibri-Light", "SegoeUI-Semibold", "Helvetica", "MaPoliceMaison-Medium"]) {
      expect(documentFontFor(name, {}, catalog)).toBeNull();
    }
  });

  it("est réenregistrée à la reprise d'un travail", () => {
    const key = `doc:Poppins|300|1|${FONTSOURCE_URL}poppins@latest/latin-300-italic.ttf`;
    restoreDocumentFont(key);
    expect(getFont(key)).toMatchObject({ family: "Poppins", italic: true });
  });

  describe("téléchargée et intégrée au PDF", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("télécharge le fichier de la graisse voulue à l'enregistrement", async () => {
      const ttf = readFileSync("node_modules/@expo-google-fonts/carlito/400Regular/Carlito_400Regular.ttf");
      const fetchMock = vi.fn(async () => new Response(ttf));
      vi.stubGlobal("fetch", fetchMock);
      const key = documentFontFor("Montserrat-ExtraBold", {}, catalog)!;
      const doc = await PDFDocument.create();
      doc.addPage([595, 842]);
      await exportPdf(await doc.save(), ["p"], [
        { id: "t", pageId: "p", kind: "text", origin: [72, 700], text: "Preuve", fontKey: key, fontSize: 14, color: "#000000", opacity: 1, rotation: 0 },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(`${FONTSOURCE_URL}montserrat@latest/latin-800-normal.ttf`);
    });
  });
});
