import { createWorker, OEM, type Worker } from "tesseract.js";
import type { PDFDocumentProxy } from "./pdfjs";
import type { OcrWord } from "./ocrLayer";
import type { Point } from "./types";

export type OcrLanguage = "fra" | "eng" | "fra+eng";

export interface OcrProgress {
  page: number;
  total: number;
  /** Avancement de la page en cours, de 0 à 1. */
  fraction: number;
  status: string;
}

const base = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;

/**
 * Crée un moteur Tesseract à partir des fichiers hébergés avec l'application
 * (public/ocr) : aucune requête vers un service externe.
 */
async function makeWorker(lang: OcrLanguage, onLog: (status: string, progress: number) => void): Promise<Worker> {
  return createWorker(lang.split("+"), OEM.LSTM_ONLY, {
    workerPath: `${base()}worker.min.js`,
    corePath: `${base()}core`,
    langPath: `${base()}lang`,
    gzip: true,
    cacheMethod: "write",
    logger: (m: { status: string; progress: number }) => onLog(m.status, m.progress),
  });
}

/** Une page contient-elle déjà du texte (sinon c'est probablement un scan) ? */
export async function pageHasText(pdf: PDFDocumentProxy, index: number): Promise<boolean> {
  const page = await pdf.getPage(index + 1);
  const content = await page.getTextContent();
  const text = (content.items as { str?: string }[]).map((i) => i.str ?? "").join("");
  return text.replace(/\s/g, "").length > 20;
}

/**
 * Reconnaît le texte des pages demandées. Chaque page est rendue en haute
 * définition (≈ 300 ppp) telle qu'elle s'affiche, puis les mots trouvés sont
 * convertis en coordonnées PDF (rotation de page comprise).
 */
export async function recognizePages(
  pdf: PDFDocumentProxy,
  indices: number[],
  lang: OcrLanguage,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<Map<number, OcrWord[]>> {
  let current = 0;
  const worker = await makeWorker(lang, (status, progress) =>
    onProgress({
      page: current + 1,
      total: indices.length,
      fraction: status === "recognizing text" ? progress : 0,
      status: status === "recognizing text" ? "Reconnaissance du texte" : "Chargement du moteur de reconnaissance",
    }),
  );
  const result = new Map<number, OcrWord[]>();
  try {
    for (current = 0; current < indices.length; current++) {
      if (signal?.aborted) break;
      const index = indices[current];
      const page = await pdf.getPage(index + 1);
      const flat = page.getViewport({ scale: 1 });
      const scale = Math.min(4.2, 3300 / Math.max(flat.width, flat.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;

      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      const words: OcrWord[] = [];
      const toPdf = (x: number, y: number) => viewport.convertToPdfPoint(x, y) as Point;
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const bl = line.baseline;
            const slope = bl.x1 !== bl.x0 ? (bl.y1 - bl.y0) / (bl.x1 - bl.x0) : 0;
            const baselineAt = (x: number) => bl.y0 + slope * (x - bl.x0);
            for (const word of line.words) {
              const text = word.text.trim();
              if (!text || word.confidence < 20) continue;
              const { x0, y0, x1, y1 } = word.bbox;
              // Ligne de base de la ligne ; à défaut, bas du mot moins les jambages.
              const fromLine = Number.isFinite(bl.y0) && bl.y0 > 0;
              const by0 = fromLine ? baselineAt(x0) : y1 - (y1 - y0) * 0.2;
              const by1 = fromLine ? baselineAt(x1) : y1 - (y1 - y0) * 0.2;
              words.push({
                text,
                start: toPdf(x0, by0),
                end: toPdf(x1, by1),
                height: (y1 - y0) / scale,
              });
            }
          }
        }
      }
      result.set(index, words);
      canvas.width = canvas.height = 0;
      onProgress({ page: current + 1, total: indices.length, fraction: 1, status: "Reconnaissance du texte" });
    }
  } finally {
    await worker.terminate();
  }
  return result;
}
