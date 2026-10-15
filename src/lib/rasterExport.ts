import { PDFDocument, degrees } from "pdf-lib";
import { compatFontkit } from "./fontkitCompat";
import type { PDFDocumentProxy } from "./pdfjs";
import type { Annotation } from "./types";
import { translateAnnotation } from "./annotations";
import { FontCache, drawAnnotation } from "./exportPdf";

/**
 * Export pour les PDF chiffrés (ouverts avec leur mot de passe) dont les
 * permissions autorisent la modification : pdf-lib ne sait pas réécrire un
 * PDF chiffré, on reconstruit donc chaque page à partir de son rendu en image,
 * puis on y dessine les annotations. Le texte d'origine n'est plus sélectionnable.
 */
export async function rasterExport(
  pdf: PDFDocumentProxy,
  pageIds: string[],
  annotations: Annotation[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.registerFontkit(compatFontkit);
  out.setProducer("Feuillet PDF");
  const fonts = new FontCache(out);
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const flat = page.getViewport({ scale: 1, rotation: 0 });
    const [x0, y0, x1, y1] = flat.viewBox;
    const scale = Math.min(2.5, 4000 / Math.max(flat.width, flat.height));
    const viewport = page.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Rendu impossible"))), "image/jpeg", 0.9),
    );
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const w = x1 - x0;
    const h = y1 - y0;
    const outPage = out.addPage([w, h]);
    outPage.drawImage(img, { x: 0, y: 0, width: w, height: h });
    outPage.setRotation(degrees(page.rotate));
    for (const a of annotations.filter((a) => a.pageId === pageIds[i])) {
      await drawAnnotation(out, outPage, translateAnnotation(a, -x0, -y0), fonts);
    }
    canvas.width = canvas.height = 0;
    onProgress?.(i + 1, pdf.numPages);
  }
  return out.save();
}
