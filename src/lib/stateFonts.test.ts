import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { exportPdf } from "./exportPdf";
import { getFont } from "./fonts";
import { STATE_FONT_SERVER, marianneVariant, restoreStateFont, stateFontFor } from "./stateFonts";

describe("polices de l'État (Marianne)", () => {
  it("reconnaît la variante de Marianne d'un nom de police PDF", () => {
    expect(marianneVariant("SNKBLT+Marianne-Regular")).toBe("Marianne-Regular");
    expect(marianneVariant("UQJNNP+Marianne-ExtraBold")).toBe("Marianne-ExtraBold");
    expect(marianneVariant("XDPVDJ+Marianne-Bold")).toBe("Marianne-Bold");
    expect(marianneVariant("Marianne-BoldItalic")).toBe("Marianne-Bold_Italic");
    expect(marianneVariant("Marianne-Light")).toBe("Marianne-Light");
    expect(marianneVariant("Marianne-Medium")).toBe("Marianne-Medium");
    expect(marianneVariant("Marianne,Bold")).toBe("Marianne-Bold");
    expect(marianneVariant("Marianne", { bold: true, italic: true })).toBe("Marianne-Bold_Italic");
  });

  it("n'est proposée que pour un PDF déjà composé en Marianne", () => {
    expect(stateFontFor("ABCDEF+ArialMT")).toBeNull();
    expect(stateFontFor("Mariannette-Regular")).toBeNull();
    expect(stateFontFor(undefined)).toBeNull();
    expect(stateFontFor("SNKBLT+Marianne-Regular")).toBe("etat:Marianne-Regular");
    expect(getFont("etat:Marianne-Regular").family).toBe("Marianne");
  });

  it("est réenregistrée à la reprise d'un travail", () => {
    restoreStateFont("etat:Marianne-Thin_Italic");
    expect(getFont("etat:Marianne-Thin_Italic")).toMatchObject({ family: "Marianne", italic: true, bold: false });
    restoreStateFont("lib:arimo:regular");
  });

  describe("chargée depuis le serveur officiel et intégrée au PDF", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("télécharge la variante voulue et l'intègre à l'enregistrement", async () => {
      // Le serveur est simulé (pas de réseau en test) : une police TrueType quelconque.
      const ttf = readFileSync("node_modules/@expo-google-fonts/carlito/700Bold/Carlito_700Bold.ttf");
      const fetchMock = vi.fn(async () => new Response(ttf));
      vi.stubGlobal("fetch", fetchMock);
      const key = stateFontFor("UQJNNP+Marianne-ExtraBold")!;
      const doc = await PDFDocument.create();
      doc.addPage([595, 842]);
      const out = await exportPdf(await doc.save(), ["p"], [
        { id: "t", pageId: "p", kind: "text", origin: [72, 700], text: "Preuve", fontKey: key, fontSize: 18, color: "#000000", opacity: 1, rotation: 0 },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(`${STATE_FONT_SERVER}Marianne-ExtraBold.woff2`);
      const re = await PDFDocument.load(out);
      const fonts = re.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      expect(fonts.keys().length).toBe(1);
    });
  });
});
