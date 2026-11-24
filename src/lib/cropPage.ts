import { PDFDocument, degrees } from "pdf-lib";
import type { PDFPageProxy } from "./pdfjs";
import type { Annotation, Rect } from "./types";
import { newId } from "./types";
import { pointsBox } from "./annotations";
import { imageDetailsFromOps, type ImageOpCodes } from "./pageImages";
import { duplicatePage, type PagesResult } from "./pageOps";
import { t } from "../i18n";

/**
 * Découpe d'une page : la zone choisie devient une nouvelle page, insérée juste
 * après l'originale (qui reste intacte).
 *
 *  - En PDF : copie de la page réduite à la zone (MediaBox/CropBox). Le texte
 *    reste net et sélectionnable, mais ce qui est hors du cadre reste dans le
 *    fichier, simplement invisible.
 *  - En image : la zone est rendue en pixels (à la résolution des images de la
 *    page, une photo scannée garde sa netteté) : rien d'autre n'est conservé.
 *
 * Dans les deux cas, la nouvelle page garde le même repère que l'originale
 * (la zone n'est pas ramenée en 0, 0) : les éléments ajoutés recopiés n'ont pas
 * à être déplacés.
 */

/** Zone trop petite pour faire une page (points PDF). */
export const MIN_CROP = 12;

export interface CropImage {
  bytes: Uint8Array;
  type: "jpg" | "png";
}

export async function cropPage(bytes: Uint8Array, pageIds: string[], at: number, rect: Rect, image?: CropImage): Promise<PagesResult> {
  const [x1, y1, x2, y2] = rect;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < MIN_CROP || h < MIN_CROP) throw new Error(t("La zone à découper est trop petite."));
  if (!image) {
    const r = await duplicatePage(bytes, pageIds, at);
    const doc = await PDFDocument.load(r.bytes, { updateMetadata: false });
    const page = doc.getPage(at + 1);
    page.setMediaBox(x1, y1, w, h);
    page.setCropBox(x1, y1, w, h);
    page.setBleedBox(x1, y1, w, h);
    page.setTrimBox(x1, y1, w, h);
    page.setArtBox(x1, y1, w, h);
    return { bytes: await doc.save(), pageIds: r.pageIds };
  }
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const rotation = doc.getPage(at).getRotation().angle;
  const embedded = image.type === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  const page = doc.insertPage(at + 1, [w, h]);
  page.setMediaBox(x1, y1, w, h);
  page.setRotation(degrees(rotation));
  page.drawImage(embedded, { x: x1, y: y1, width: w, height: h });
  const ids = [...pageIds];
  ids.splice(at + 1, 0, newId("page"));
  return { bytes: await doc.save(), pageIds: ids };
}

/** Rectangle approximatif occupé par un élément ajouté (pour savoir s'il touche la zone). */
function bounds(a: Annotation): Rect {
  switch (a.kind) {
    case "ink":
      return pointsBox(a.points);
    case "line":
      return pointsBox([a.from, a.to, ...(a.control ? [a.control] : [])]);
    case "text": {
      const lines = a.text.split("\n").length;
      const width = a.box?.width ?? Math.max(...a.text.split("\n").map((l) => l.length)) * a.fontSize * 0.6;
      const [x, y] = a.origin;
      // Le texte peut avoir été posé sur une page tournée : on prend large dans toutes les directions.
      const r = Math.max(width, lines * a.fontSize * 1.3);
      return [x - r, y - r, x + r, y + a.fontSize];
    }
    default:
      return a.rect;
  }
}

const intersects = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Copies, pour la nouvelle page, des éléments ajoutés qui touchent la zone (la
 * page découpée masque ce qui dépasse). Les caches de « Modifier le texte »
 * suivent le texte auquel ils appartiennent.
 */
export function cropAnnotations(annotations: Annotation[], fromPage: string, toPage: string, rect: Rect): Annotation[] {
  const source = annotations.filter((a) => a.pageId === fromPage);
  // Un texte modifié et ses caches forment un groupe : copié en entier dès qu'une partie touche la zone.
  const group = (a: Annotation) => (a.kind === "whiteout" && a.owner ? a.owner : a.id);
  const groups = new Set(source.filter((a) => intersects(bounds(a), rect)).map(group));
  const copied = source.filter((a) => groups.has(group(a)));
  const ids = new Map(copied.map((a) => [a.id, newId("annot")]));
  return copied.map((a) => ({
    ...a,
    id: ids.get(a.id)!,
    pageId: toPage,
    ...(a.kind === "whiteout" && a.owner ? { owner: ids.get(a.owner) ?? a.owner } : {}),
  }));
}

/**
 * Résolution (pixels par point) à laquelle rendre la zone : celle de la plus
 * fine image de la page qui touche la zone, sinon une valeur qui garde le texte
 * bien net. Limitée pour ne pas produire d'image démesurée.
 */
export function cropResolution(images: { rect: Rect; width?: number; height?: number }[], rect: Rect): number {
  let best = 0;
  for (const im of images) {
    if (!im.width || !im.height || !intersects(im.rect, rect)) continue;
    const pw = im.rect[2] - im.rect[0];
    const ph = im.rect[3] - im.rect[1];
    if (pw < 1 || ph < 1) continue;
    best = Math.max(best, Math.max(im.width / pw, im.height / ph));
  }
  const k = best ? Math.min(Math.max(best, 2), 8) : 4;
  const long = Math.max(rect[2] - rect[0], rect[3] - rect[1]);
  return Math.min(k, 6000 / long);
}

/** La page est-elle surtout une image (page numérisée, photo) ? On découpe alors en image par défaut. */
export function isImagePage(images: { rect: Rect }[], view: Rect): boolean {
  const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  return images.some((im) => area(im.rect) >= area(view) * 0.6);
}

/** Images de la page avec leur taille en pixels (pour la découpe). */
export async function pageImagesDetailed(page: PDFPageProxy) {
  try {
    const [{ pdfjs }, list] = await Promise.all([import("./pdfjs"), page.getOperatorList()]);
    return imageDetailsFromOps(list.fnArray, list.argsArray, pdfjs.OPS as unknown as ImageOpCodes);
  } catch {
    return [];
  }
}

/**
 * Rend la zone de la page (contenu d'origine seul : les éléments ajoutés restent
 * modifiables et sont recopiés à part), sans la rotation de la page.
 */
export async function renderCrop(page: PDFPageProxy, rect: Rect, asPng = false): Promise<CropImage> {
  const images = await pageImagesDetailed(page);
  const k = cropResolution(images, rect);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const [vx1, , , vy2] = base.viewBox;
  const viewport = page.getViewport({
    scale: k,
    rotation: 0,
    offsetX: -(rect[0] - vx1) * k,
    offsetY: -(vy2 - rect[3]) * k,
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((rect[2] - rect[0]) * k));
  canvas.height = Math.max(1, Math.round((rect[3] - rect[1]) * k));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvas, viewport }).promise;
    const mime = asPng ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(t("Rendu impossible")))), mime, 0.92));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: asPng ? "png" : "jpg" };
  } finally {
    canvas.width = canvas.height = 0;
  }
}
