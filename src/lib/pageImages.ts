import { PDFDict, PDFName, PDFRawStream, type PDFDocument, type PDFPage } from "pdf-lib";
import { IDENTITY, apply, mul, parseOps, type Matrix } from "./pdfContent";
import { contentBytes, writeContent } from "./removeText";
import type { PDFPageProxy } from "./pdfjs";
import type { Rect } from "./types";

/**
 * Images du PDF d'origine (photos, logos…) : repérées pour être sélectionnées
 * sur la page, puis réellement retirées du fichier à l'enregistrement.
 */

/** Rectangle (espace PDF) couvert par l'image dessinée avec cette matrice (carré unité). */
export function imageRect(m: Matrix): Rect {
  const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Codes pdf.js utiles (passés en paramètre pour pouvoir tester sans pdf.js). */
export interface ImageOpCodes {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
}

/** Images dessinées d'après la liste d'opérations pdf.js (images placées dans des sous-dessins comprises). */
export function imagesFromOps(fnArray: ArrayLike<number>, argsArray: unknown[], ops: ImageOpCodes): Rect[] {
  const paints = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject]);
  const out: Rect[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = mul(args as unknown as Matrix, ctm);
    else if (fn === ops.paintFormXObjectBegin && args) {
      stack.push(ctm);
      const m = args[0] as Matrix | null;
      if (m) ctm = mul(m, ctm);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (paints.has(fn)) out.push(imageRect(ctm));
  }
  return out;
}

/**
 * Images sélectionnables d'une page : ni minuscules (puces, filets), ni
 * pleine page (une page scannée n'est pas une image à supprimer).
 */
export function selectableImages(rects: Rect[], pageArea: number): Rect[] {
  const seen = new Set<string>();
  return rects.filter((r) => {
    const w = r[2] - r[0];
    const h = r[3] - r[1];
    const key = r.map((v) => Math.round(v)).join(",");
    if (w < 6 || h < 6 || w * h > pageArea * 0.8 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function extractImages(page: PDFPageProxy): Promise<Rect[]> {
  try {
    const [{ pdfjs }, list] = await Promise.all([import("./pdfjs"), page.getOperatorList()]);
    const [x1, y1, x2, y2] = page.view;
    return selectableImages(imagesFromOps(list.fnArray, list.argsArray, pdfjs.OPS as unknown as ImageOpCodes), Math.abs((x2 - x1) * (y2 - y1)));
  } catch {
    return [];
  }
}

/** L'image dessinée avec cette matrice est-elle celle de la zone (centre dedans, taille voisine) ? */
function matches(r: Rect, zone: Rect): boolean {
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  const tol = 2;
  return cx >= zone[0] - tol && cx <= zone[2] + tol && cy >= zone[1] - tol && cy <= zone[3] + tol && r[2] - r[0] <= zone[2] - zone[0] + 2 * tol + 1 && r[3] - r[1] <= zone[3] - zone[1] + 2 * tol + 1;
}

/**
 * Retire du contenu de la page les images (XObject image ou image en ligne)
 * dessinées dans les zones données. Renvoie, pour chaque zone, le nombre
 * d'images retirées. Une image placée dans un sous-dessin n'est pas retirée
 * (le sous-dessin contient souvent autre chose) : l'appelant garde alors le cache.
 */
export function removeImagesInRects(doc: PDFDocument, page: PDFPage, zones: Rect[]): number[] {
  const results = zones.map(() => 0);
  if (!zones.length) return results;
  const bytes = contentBytes(doc, page);
  if (!bytes) return results;
  const xobjects = (() => {
    const res = page.node.Resources();
    const x = res ? doc.context.lookup(res.get(PDFName.of("XObject"))) : undefined;
    return x instanceof PDFDict ? x : undefined;
  })();
  const isImage = (name: string) => {
    const x = xobjects ? doc.context.lookup(xobjects.get(PDFName.of(name))) : undefined;
    const dict = x instanceof PDFRawStream ? x.dict : x instanceof PDFDict ? x : undefined;
    const sub = dict?.get(PDFName.of("Subtype"));
    return sub instanceof PDFName && sub.asString() === "/Image";
  };

  const removed: { start: number; end: number }[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (const o of parseOps(bytes)) {
    const a = o.args;
    if (o.op === "q") stack.push(ctm);
    else if (o.op === "Q") ctm = stack.pop() ?? ctm;
    else if (o.op === "cm" && a.length === 6 && a.every((v) => typeof v === "number")) ctm = mul(a as unknown as Matrix, ctm);
    else if (o.op === "Do" || o.op === "BI") {
      const name = a[0] && typeof a[0] === "object" && "name" in a[0] ? a[0].name : undefined;
      if (o.op === "Do" && (!name || !isImage(name))) continue;
      const r = imageRect(ctm);
      const k = zones.findIndex((z) => matches(r, z));
      if (k < 0) continue;
      results[k]++;
      removed.push({ start: o.start, end: o.end });
    }
  }
  if (removed.length) writeContent(doc, page, bytes, removed.map((r) => ({ ...r, text: "" })));
  return results;
}
