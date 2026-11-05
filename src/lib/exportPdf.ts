import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  degrees,
  rgb,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import { compatFontkit, withPreferredFont } from "./fontkitCompat";
import { drawEmbeddedText, embeddedTextWidth, missingChars } from "./embeddedFonts";
import { fontIndexAt, layoutFor } from "./textBlocks";
import { createFormField } from "./formFields";
import { removeTextInRects } from "./removeText";
import { curvePoints, rectCenter } from "./annotations";
import { shapeDef } from "./shapes";
import type { Annotation, Point, ShapeAnnotation, TextAnnotation } from "./types";
import { addScaled, arrowHead, hexToRgb01, normalizeRotation, screenAxes, shapeBox } from "./geometry";
import { fontBytes, getFont } from "./fonts";
import { t } from "../i18n";

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

/** Soulignement et barré d'une ligne. */
export function decorations(a: TextAnnotation, lineIndex: number, width: number): [Point, Point][] {
  const out: [Point, Point][] = [];
  if (a.underline) out.push(underlineSegment(a, lineIndex, width));
  if (a.strike) {
    const { right, down } = screenAxes(a.rotation);
    const base = addScaled(a.origin, down, a.fontSize * LINE_HEIGHT * lineIndex - a.fontSize * 0.3);
    out.push([base, addScaled(base, right, width)]);
  }
  return out;
}

async function drawTextAnnotation(doc: PDFDocument, page: PDFPage, a: TextAnnotation, fonts: FontCache) {
  // Police d'origine du PDF, lettre par lettre ; police de remplacement pour les seuls glyphes absents.
  if (a.embedded && (await drawEmbeddedText(doc, page, { ...a, embedded: a.embedded }, () => fonts.get(a.fontKey)))) return;
  await drawText(page, a, await fonts.get(a.fontKey));
}

/**
 * Bloc de texte remis en page : une annotation par morceau de même style
 * (gras, lien, symbole…) sur chaque ligne, par mot sur une ligne justifiée.
 */
export async function blockParts(a: TextAnnotation, loadFont: (key: string) => Promise<PDFFont>): Promise<TextAnnotation[]> {
  // Texte libre aligné : lignes alignées sur la plus longue (pas de largeur imposée).
  const box = a.box ?? { width: 0, align: a.align ?? "left", lineHeight: a.fontSize * LINE_HEIGHT, space: undefined };
  const styles = a.styles ?? [];
  const at = (i: number) => fontIndexAt(styles, i);
  const styleOf = (k: number) => (k >= 0 && a.fonts?.[k]) || { fontKey: a.fontKey, embedded: a.embedded };
  // Caractères de chaque style, pour ne charger une police de remplacement que si elle sert :
  // une police CFF (Marianne…) intégrée sans aucun caractère fait échouer l'enregistrement (fontkit).
  const used = new Map<number, string>();
  [...a.text].forEach((ch, i) => used.set(at(i), (used.get(at(i)) ?? "") + ch));
  const fallback = new Map<number, PDFFont | null>();
  for (const [k, chars] of used) {
    const st = styleOf(k);
    fallback.set(k, !st.embedded || missingChars(st.embedded, chars).length ? await loadFont(st.fontKey) : null);
  }
  const widthOf = (k: number, str: string) => {
    const st = styleOf(k);
    const fb = fallback.get(k) ?? null;
    const fbWidth = (x: string) => fb?.widthOfTextAtSize(x, a.fontSize) ?? x.length * a.fontSize * 0.5;
    return st.embedded ? embeddedTextWidth(st.embedded, str, a.fontSize, fbWidth) : fbWidth(str);
  };
  /** Morceaux de même style d'un passage situé à `offset`. */
  const runsOf = (str: string, offset: number) => {
    const out: { text: string; font: number; at: number }[] = [];
    [...str].forEach((ch, i) => {
      const f = at(offset + i);
      const last = out[out.length - 1];
      if (last && last.font === f) last.text += ch;
      else out.push({ text: ch, font: f, at: offset + i });
    });
    return out;
  };
  // Espaces : largeur réelle mesurée dans le PDF d'origine, sinon celle de la police.
  const spaceW = (offset: number) => box.space ?? widthOf(at(offset), " ");
  const measure = (str: string, offset: number) =>
    runsOf(str, offset).reduce((w, r) => w + (box.space !== undefined ? widthOf(r.font, r.text.replace(/ /g, "")) + (r.text.split(" ").length - 1) * box.space : widthOf(r.font, r.text)), 0);
  const { right, down } = screenAxes(a.rotation);
  const parts: TextAnnotation[] = [];
  const base = { ...a, box: undefined, align: undefined, styles: undefined, fonts: undefined };
  layoutFor(a, measure).forEach((l, i) => {
    if (!l.text) return;
    const start = addScaled(addScaled(a.origin, down, i * box.lineHeight), right, l.x);
    let x = 0;
    // Chaque mot est placé lui-même : espaces à leur largeur d'origine, élargies si justifié.
    const pieces = l.wordSpacing || box.space !== undefined ? l.text.split(/( )/) : [l.text];
    let offset = l.start;
    for (const piece of pieces) {
      if (piece === " ") {
        x += spaceW(offset) + l.wordSpacing;
        offset += 1;
        continue;
      }
      for (const r of runsOf(piece, offset)) {
        const st = styleOf(r.font);
        const part: TextAnnotation = { ...base, text: r.text, origin: addScaled(start, right, x), fontKey: st.fontKey };
        if (st.embedded) part.embedded = st.embedded;
        else delete part.embedded;
        parts.push(part);
        x += widthOf(r.font, r.text);
      }
      offset += piece.length;
    }
  });
  return parts;
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
        t(
          "La police « {font} » ne contient pas certains caractères de « {line} ». Choisissez une police installée ou importée qui les couvre.",
          { font: getFont(a.fontKey).label, line },
        ),
      );
    }
    const [x, y] = addScaled(a.origin, down, a.fontSize * LINE_HEIGHT * i);
    const width = font.widthOfTextAtSize(line, a.fontSize);
    if (a.highlight) {
      // Fond sous la ligne (multiplié : le contenu de la page reste lisible).
      const [bx, by] = addScaled([x, y], down, a.fontSize * 0.26);
      const back = addScaled([bx, by], screenAxes(a.rotation).right, -a.fontSize * 0.06);
      page.drawRectangle({
        x: back[0],
        y: back[1],
        width: width + a.fontSize * 0.12,
        height: a.fontSize * 1.12,
        rotate: degrees(a.rotation),
        color: color(a.highlight),
        opacity: a.opacity,
        blendMode: BlendMode.Multiply,
      });
    }
    page.drawText(line, {
      x,
      y,
      size: a.fontSize,
      font,
      color: color(a.color),
      opacity: a.opacity,
      rotate: degrees(a.rotation),
    });
    for (const [from, to] of decorations(a, i, width)) {
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
  // Rotation propre (formes, images) : tout le dessin tourne autour du centre de l'élément.
  // Texte : autour de son pivot (fixé au premier pivotement).
  const pivot = !a.angle ? null : "rect" in a && a.rect ? rectCenter(a.rect) : a.kind === "text" ? (a.pivot ?? a.origin) : null;
  if (a.angle && pivot) {
    const [cx, cy] = pivot;
    const r = (-a.angle * Math.PI) / 180; // sens horaire à l'écran = sens inverse dans le repère PDF
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy));
    try {
      await drawAnnotationBase(doc, page, a, fonts);
    } finally {
      page.pushOperators(popGraphicsState());
    }
    return;
  }
  return drawAnnotationBase(doc, page, a, fonts);
}

async function drawAnnotationBase(doc: PDFDocument, page: PDFPage, a: Annotation, fonts: FontCache) {
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
      // Courbe : découpée en petits segments (extrémités arrondies, rendu continu).
      const path = a.control ? curvePoints(a.from, a.to, a.control) : [a.from, a.to];
      const segments: [Point, Point][] = path.slice(1).map((p, i) => [path[i], p]);
      if (a.arrow) for (const p of arrowHead(a.control ?? a.from, a.to, a.width)) segments.push([a.to, p]);
      if (a.arrowStart) for (const p of arrowHead(a.control ?? a.to, a.from, a.width)) segments.push([a.from, p]);
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
      if (a.box || (a.align && a.align !== "left")) {
        // Bloc : remis en page dans sa largeur, puis écrit ligne par ligne (mot par mot si justifié).
        for (const part of await blockParts(a, (key) => fonts.get(key))) await drawTextAnnotation(doc, page, part, fonts);
        return;
      }
      await drawTextAnnotation(doc, page, a, fonts);
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
 * Retire du contenu de la page le texte d'origine sous les caches :
 * - cache de « Modifier le texte » : la ligne d'origine est retirée ; le cache
 *   devient inutile si tout le texte retiré était visible (pour une couche OCR
 *   invisible, l'image scannée montre encore l'ancien texte : on le garde) ;
 * - cache blanc dessiné à la main : le texte dessous est retiré du fichier
 *   (plus copiable ni indexable) et le cache reste dessiné.
 * Renvoie les caches à ne pas dessiner.
 */
function removeOriginalText(doc: PDFDocument, page: PDFPage, list: Annotation[]): Set<Annotation> {
  const covers = list.filter((a): a is ShapeAnnotation => a.kind === "whiteout");
  const done = new Set<Annotation>();
  if (!covers.length) return done;
  // Fond opaque choisi pour le texte modifié : son cache reste dessiné (il masque ce qui est dessous).
  const opaque = new Set(list.flatMap((a) => (a.kind === "text" && a.coverOpaque ? [a.id] : [])));
  try {
    const results = removeTextInRects(doc, page, covers.map((c) => c.removeText ?? { rect: c.rect }));
    results.forEach((r, k) => {
      if (covers[k].removeText && r.removed > 0 && r.invisible === 0 && !opaque.has(covers[k].owner ?? "")) done.add(covers[k]);
    });
  } catch {
    /* contenu illisible : on garde les caches */
  }
  return done;
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
    // « Modifier le texte » : le texte d'origine est retiré du contenu de la page.
    // Le cache n'est gardé que là où ce retrait n'a pas suffi.
    const removed = removeOriginalText(doc, pages[i], list);
    const drawn = list.filter((a) => !removed.has(a));
    // Ordre de création (un cache blanc masque ce qui a été posé avant lui), sauf les caches
    // de « Modifier le texte », qui ne masquent que la ligne d'origine : tout en dessous.
    const ordered = [...drawn.filter(isTextCover), ...drawn.filter((a) => !isTextCover(a))];
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

/** Cache posé par « Modifier le texte » (il ne sert qu'à masquer la ligne d'origine du PDF). */
export function isTextCover(a: Annotation): boolean {
  return a.kind === "whiteout" && !!a.removeText;
}
