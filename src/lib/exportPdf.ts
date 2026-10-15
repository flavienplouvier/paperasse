import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  degrees,
  rgb,
} from "pdf-lib";
import { compatFontkit, withPreferredFont } from "./fontkitCompat";
import { drawEmbeddedText, usesEmbedded } from "./embeddedFonts";
import { createFormField } from "./formFields";
import { shapeDef } from "./shapes";
import type { Annotation, Point, TextAnnotation } from "./types";
import { addScaled, arrowHead, hexToRgb01, normalizeRotation, screenAxes, shapeBox } from "./geometry";
import { fontBytes, getFont } from "./fonts";

export const LINE_HEIGHT = 1.25;

function color(hex: string) {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; png: boolean } {
  const [head, b64] = dataUrl.split(",", 2);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: head.includes("png") };
}

export class FontCache {
  private fonts = new Map<string, Promise<PDFFont>>();
  constructor(private doc: PDFDocument) {}
  get(key: string): Promise<PDFFont> {
    let f = this.fonts.get(key);
    if (!f) {
      const entry = getFont(key);
      f = entry.standard
        ? this.doc.embedFont(entry.standard)
        : fontBytes(key).then((b) =>
            withPreferredFont(entry.postscriptName, () => this.doc.embedFont(b, { subset: true })),
          );
      this.fonts.set(key, f);
    }
    return f;
  }
}

/** Trait de soulignement sous une ligne de texte (épaisseur et position usuelles). */
export function underlineSegment(a: TextAnnotation, lineIndex: number, width: number): [Point, Point] {
  const { right, down } = screenAxes(a.rotation);
  const base = addScaled(a.origin, down, a.fontSize * LINE_HEIGHT * lineIndex + a.fontSize * 0.12);
  return [base, addScaled(base, right, width)];
}

async function drawText(page: PDFPage, a: TextAnnotation, font: PDFFont) {
  const { down } = screenAxes(a.rotation);
  const lines = a.text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line) return;
    try {
      font.encodeText(line);
    } catch {
      throw new Error(
        `La police « ${getFont(a.fontKey).label} » ne contient pas certains caractères de « ${line} ». Choisissez une police installée ou importée qui les couvre.`,
      );
    }
    const [x, y] = addScaled(a.origin, down, a.fontSize * LINE_HEIGHT * i);
    page.drawText(line, {
      x,
      y,
      size: a.fontSize,
      font,
      color: color(a.color),
      opacity: a.opacity,
      rotate: degrees(a.rotation),
    });
    if (a.underline) {
      const [from, to] = underlineSegment(a, i, font.widthOfTextAtSize(line, a.fontSize));
      page.drawLine({
        start: { x: from[0], y: from[1] },
        end: { x: to[0], y: to[1] },
        thickness: Math.max(0.5, a.fontSize * 0.07),
        color: color(a.color),
        opacity: a.opacity,
      });
    }
  });
}

export async function drawAnnotation(doc: PDFDocument, page: PDFPage, a: Annotation, fonts: FontCache) {
  switch (a.kind) {
    case "ink": {
      for (let i = 1; i < a.points.length; i++) {
        page.drawLine({
          start: { x: a.points[i - 1][0], y: a.points[i - 1][1] },
          end: { x: a.points[i][0], y: a.points[i][1] },
          thickness: a.width,
          color: color(a.color),
          opacity: a.opacity,
          lineCap: LineCapStyle.Round,
        });
      }
      if (a.points.length === 1) {
        page.drawCircle({ x: a.points[0][0], y: a.points[0][1], size: a.width / 2, color: color(a.color), opacity: a.opacity });
      }
      return;
    }
    case "line": {
      const segments: [Point, Point][] = [[a.from, a.to]];
      if (a.arrow) for (const p of arrowHead(a.from, a.to, a.width)) segments.push([a.to, p]);
      if (a.arrowStart) for (const p of arrowHead(a.to, a.from, a.width)) segments.push([a.from, p]);
      for (const [s, e] of segments) {
        page.drawLine({
          start: { x: s[0], y: s[1] },
          end: { x: e[0], y: e[1] },
          thickness: a.width,
          color: color(a.color),
          opacity: a.opacity,
          lineCap: LineCapStyle.Round,
        });
      }
      return;
    }
    case "highlight":
    case "whiteout":
    case "rect": {
      const [x1, y1, x2, y2] = a.rect;
      const filled = a.kind !== "rect" || a.fill;
      page.drawRectangle({
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        color: filled ? color(a.color) : undefined,
        opacity: a.opacity,
        borderColor: filled ? undefined : color(a.color),
        borderWidth: filled ? 0 : a.width,
        borderOpacity: a.opacity,
        blendMode: a.kind === "highlight" ? BlendMode.Multiply : undefined,
      });
      return;
    }
    case "ellipse": {
      const [x1, y1, x2, y2] = a.rect;
      page.drawEllipse({
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2,
        xScale: (x2 - x1) / 2,
        yScale: (y2 - y1) / 2,
        color: a.fill ? color(a.color) : undefined,
        opacity: a.opacity,
        borderColor: a.fill ? undefined : color(a.color),
        borderWidth: a.fill ? 0 : a.width,
        borderOpacity: a.opacity,
      });
      return;
    }
    case "text":
      // Police d'origine du PDF si tous les caractères y figurent, sinon police de remplacement.
      if (usesEmbedded(a) && drawEmbeddedText(doc, page, a)) return;
      await drawText(page, a, await fonts.get(a.fontKey));
      return;
    case "field":
      createFormField(doc, page, a);
      return;
    case "shape": {
      const def = shapeDef(a.shape);
      if (!def.path) return;
      const box = shapeBox(a.rect, a.rotation);
      const filled = a.fill && !def.open;
      page.drawSvgPath(def.path(box.width, box.height), {
        x: box.origin[0],
        y: box.origin[1],
        rotate: degrees(normalizeRotation(a.rotation)),
        color: filled ? color(a.color) : undefined,
        opacity: a.opacity,
        borderColor: filled ? undefined : color(a.color),
        borderWidth: filled ? 0 : a.width,
        borderOpacity: a.opacity,
        borderLineCap: LineCapStyle.Round,
      });
      return;
    }
    case "image": {
      const { bytes, png } = dataUrlToBytes(a.dataUrl);
      const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const [x1, y1, x2, y2] = a.rect;
      page.drawImage(img, { x: x1, y: y1, width: x2 - x1, height: y2 - y1, opacity: a.opacity });
      return;
    }
  }
}

/**
 * Produit le PDF final : les annotations sont dessinées dans le contenu des
 * pages (lisibles par tous les lecteurs PDF). Le reste du document — texte,
 * polices d'origine, images, liens, formulaires — est conservé tel quel.
 */
export async function exportPdf(
  bytes: Uint8Array,
  pageIds: string[],
  annotations: Annotation[],
  options: { flattenForms?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.registerFontkit(compatFontkit);
  doc.setProducer("Paperasse PDF");
  doc.setModificationDate(new Date());
  const fonts = new FontCache(doc);
  const pages = doc.getPages();
  const byPage = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const list = byPage.get(a.pageId) ?? [];
    list.push(a);
    byPage.set(a.pageId, list);
  }
  for (let i = 0; i < pages.length; i++) {
    const list = byPage.get(pageIds[i]);
    if (!list) continue;
    // Les caches blancs d'abord pour que le texte de remplacement passe au-dessus.
    const ordered = [...list.filter((a) => a.kind === "whiteout"), ...list.filter((a) => a.kind !== "whiteout")];
    for (const a of ordered) await drawAnnotation(doc, pages[i], a, fonts);
  }
  if (options.flattenForms) {
    try {
      doc.getForm().flatten();
    } catch {
      /* formulaire absent ou non aplatissable : on garde les champs */
    }
  }
  return doc.save();
}
