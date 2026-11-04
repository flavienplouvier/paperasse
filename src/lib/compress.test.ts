import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import UPNG from "@pdf-lib/upng";
import { compressPdf, formatSize, imageDisplaySizes, unpredictPng, type ImageEncoder, type ImageSource } from "./compress";

/** PNG RVB (ou RVBA) de w×h pixels au contenu bruité (peu compressible, comme une photo). */
function noisyPng(w: number, h: number, alpha = false): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  let seed = 7;
  for (let i = 0; i < rgba.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rgba[i] = seed & 255;
    if (i % 4 === 3) rgba[i] = alpha ? (i / 4) % 256 : 255;
  }
  return new Uint8Array(UPNG.encode([rgba.buffer], w, h, 0));
}

/** Encodeur simulé : note chaque appel et renvoie un « JPEG » de la taille voulue. */
function fakeEncoder(outputSize = 1000) {
  const calls: { src: ImageSource; width: number; height: number; quality: number }[] = [];
  const encode: ImageEncoder = async (src, width, height, quality) => {
    calls.push({ src, width, height, quality });
    const out = new Uint8Array(outputSize);
    out[0] = 0xff;
    out[1] = 0xd8;
    return out;
  };
  return { encode, calls };
}

function images(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
    .map(([ref, o]) => ({ ref, dict: (o as PDFRawStream).dict, size: (o as PDFRawStream).getContents().length }));
}
const n = (d: PDFDict, k: string) => (d.get(PDFName.of(k)) as PDFNumber | undefined)?.asNumber();

async function pdfWithImage(px: [number, number], shown: [number, number], alpha = false) {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(noisyPng(px[0], px[1], alpha));
  doc.addPage([595, 842]).drawImage(img, { x: 50, y: 400, width: shown[0], height: shown[1] });
  return doc.save();
}

describe("compression : taille d'affichage des images", () => {
  it("retient la plus grande taille d'affichage, y compris dans un XObject de formulaire", async () => {
    const src = await PDFDocument.create();
    const img = await src.embedPng(noisyPng(100, 50));
    const page = src.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 144, height: 72 });
    const doc = await PDFDocument.create();
    const [form] = await doc.embedPdf(await src.save());
    const p = doc.addPage([595, 842]);
    p.drawPage(form, { x: 0, y: 0, xScale: 2, yScale: 2 });
    p.drawPage(form, { x: 0, y: 0, xScale: 0.5, yScale: 0.5 });
    const loaded = await PDFDocument.load(await doc.save());
    const sizes = [...imageDisplaySizes(loaded).values()];
    expect(sizes).toHaveLength(1);
    expect(sizes[0].w).toBeCloseTo(288, 3);
    expect(sizes[0].h).toBeCloseTo(144, 3);
  });
});

describe("compression des images", () => {
  it("recommandée : ramène une image trop fine à 150 ppp et garde son masque de transparence", async () => {
    // 1200×600 px affichée sur 2 × 1 pouces (144 × 72 pt) = 600 ppp → 300 × 150 px à 150 ppp.
    const bytes = await pdfWithImage([1200, 600], [144, 72], true);
    const { encode, calls } = fakeEncoder();
    const { bytes: out, report } = await compressPdf(bytes, "balanced", encode);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ width: 300, height: 150, quality: 0.75 });
    expect("pixels" in calls[0].src && calls[0].src.channels).toBe(3);
    const doc = await PDFDocument.load(out);
    const main = images(doc).find((i) => i.dict.get(PDFName.of("Filter")) === PDFName.of("DCTDecode"))!;
    expect([n(main.dict, "Width"), n(main.dict, "Height")]).toEqual([300, 150]);
    expect(main.dict.get(PDFName.of("SMask"))).toBeInstanceOf(PDFRef);
    expect(report.images).toBe(1);
    expect(out.length).toBeLessThan(bytes.length / 5);
  });

  it("recommandée : ne réencode pas une image déjà à la bonne résolution", async () => {
    const bytes = await pdfWithImage([300, 150], [144, 72]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "balanced", encode);
    expect(calls).toHaveLength(0);
  });

  it("forte : 96 ppp et JPEG plus compressé, même pour une image déjà à la bonne taille", async () => {
    const bytes = await pdfWithImage([192, 96], [144, 72]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "strong", encode);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ width: 192, height: 96, quality: 0.6 });
  });

  it("garde l'image d'origine quand le réencodage n'est pas nettement plus léger", async () => {
    const bytes = await pdfWithImage([400, 200], [144, 72]);
    const { encode } = fakeEncoder(10_000_000);
    const { bytes: out, report } = await compressPdf(bytes, "strong", encode);
    expect(report.images).toBe(0);
    const doc = await PDFDocument.load(out);
    expect(images(doc).every((i) => i.dict.get(PDFName.of("Filter")) === PDFName.of("FlateDecode"))).toBe(true);
  });

  it("image en niveaux de gris : réécrite en RVB (le JPEG produit est en couleur)", async () => {
    const doc = await PDFDocument.create();
    const w = 800;
    const h = 400;
    const gray = new Uint8Array(w * h).map((_, i) => (i * 37) % 251);
    const stream = doc.context.flateStream(gray, { Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceGray", BitsPerComponent: 8 });
    const ref = doc.context.register(stream);
    const page = doc.addPage([595, 842]);
    const name = page.node.newXObject("Im0", ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(144, 0, 0, 72, 50, 400), drawObject(name), popGraphicsState());
    const bytes = await doc.save();
    const { encode, calls } = fakeEncoder();
    const { bytes: out } = await compressPdf(bytes, "balanced", encode);
    expect(calls).toHaveLength(1);
    expect("pixels" in calls[0].src && calls[0].src.channels).toBe(1);
    const img = images(await PDFDocument.load(out))[0];
    expect(img.dict.get(PDFName.of("ColorSpace"))).toBe(PDFName.of("DeviceRGB"));
  });

  it("ignore les images non prises en charge (masque, CMJN, palette)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const add = (name: string, dict: Record<string, unknown>, data: Uint8Array) => {
      const ref = doc.context.register(doc.context.flateStream(data, { Type: "XObject", Subtype: "Image", Width: 400, Height: 400, ...dict } as never));
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(20, 0, 0, 20, 0, 0), drawObject(page.node.newXObject(name, ref)), popGraphicsState());
    };
    add("Masque", { ImageMask: true, BitsPerComponent: 1 }, new Uint8Array(20000));
    add("Cmjn", { ColorSpace: "DeviceCMYK", BitsPerComponent: 8 }, new Uint8Array(640000));
    add("Palette", { ColorSpace: doc.context.obj(["Indexed", "DeviceRGB", 1, doc.context.obj([])]), BitsPerComponent: 8 }, new Uint8Array(160000));
    const { encode, calls } = fakeEncoder();
    await compressPdf(await doc.save(), "strong", encode);
    expect(calls).toHaveLength(0);
  });

  it("décode les prédicteurs PNG (Sub, Up, Average, Paeth)", async () => {
    const w = 3;
    const pixels = Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 15, 25, 35, 45, 55, 65, 75, 85, 95, 1, 2, 3, 4, 5, 6, 7, 8, 9, 200, 100, 50, 25, 12, 6, 3, 1, 0]);
    const rows = pixels.length / (w * 3);
    // Encode chaque ligne avec un filtre différent (types 1 à 4).
    const encoded: number[] = [];
    for (let y = 0; y < rows; y++) {
      const type = y + 1;
      encoded.push(type);
      for (let x = 0; x < w * 3; x++) {
        const v = pixels[y * w * 3 + x];
        const left = x >= 3 ? pixels[y * w * 3 + x - 3] : 0;
        const up = y > 0 ? pixels[(y - 1) * w * 3 + x] : 0;
        const ul = y > 0 && x >= 3 ? pixels[(y - 1) * w * 3 + x - 3] : 0;
        const p = left + up - ul;
        const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - ul) ? left : Math.abs(p - up) <= Math.abs(p - ul) ? up : ul;
        const pred = [0, left, up, (left + up) >> 1, paeth][type];
        encoded.push((v - pred) & 255);
      }
    }
    expect(unpredictPng(Uint8Array.from(encoded), w, 3)).toEqual(pixels);
  });
});

describe("compression sans perte", () => {
  it("supprime les objets inutilisés et compresse les flux bruts, sans rien changer à l'affichage", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText("Texte conservé", { x: 72, y: 700, size: 14, font });
    // Objet orphelin volumineux (ex. page supprimée) et flux non compressé utilisé.
    doc.context.register(doc.context.stream(new Uint8Array(200_000).fill(65)));
    const used = doc.context.register(doc.context.stream("x ".repeat(50_000)));
    doc.catalog.set(PDFName.of("PaperasseTest"), used);
    const bytes = await doc.save({ useObjectStreams: false });

    const { bytes: out, report } = await compressPdf(bytes, "lossless");
    expect(report.removedObjects).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThan(bytes.length / 10);
    const reloaded = await PDFDocument.load(out);
    const kept = reloaded.context.lookup(reloaded.catalog.get(PDFName.of("PaperasseTest"))) as PDFRawStream;
    expect(kept.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
    expect(text).toBe("Texte conservé");
  });

  it("ne rend jamais un fichier plus gros", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    const { bytes: out, report } = await compressPdf(bytes, "lossless");
    expect(out.length).toBeLessThanOrEqual(bytes.length);
    expect(report.after).toBe(out.length);
  });

  it("conserve les formulaires, les pages et les métadonnées", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Mon dossier");
    const page = doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    doc.getForm().createTextField("nom").addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
    const { bytes: out } = await compressPdf(await doc.save(), "lossless");
    const re = await PDFDocument.load(out);
    expect(re.getPageCount()).toBe(2);
    expect(re.getTitle()).toBe("Mon dossier");
    expect(re.getForm().getFields().map((f) => f.getName())).toEqual(["nom"]);
    expect(re.catalog.get(PDFName.of("AcroForm"))).toBeDefined();
    expect(re.getPage(0).node.Annots()).toBeInstanceOf(PDFArray);
  });
});

describe("affichage des tailles", () => {
  it("formate en Ko et Mo", () => {
    expect(formatSize(820 * 1024)).toBe("820 Ko");
    expect(formatSize(1.45 * 1024 * 1024)).toBe("1,5 Mo");
  });
});
