import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import type { Point } from "./types";
import { addScaled, hexToRgb01, normalizeRotation, screenAxes } from "./geometry";

/**
 * Ajouts appliqués à toutes (ou certaines) pages du document : numérotation,
 * en-tête et pied de page, filigrane. Les positions sont exprimées comme on
 * voit la page à l'écran, y compris pour les pages tournées.
 */

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "bottom";

export interface PageRange {
  /** Ne rien ajouter sur la première page (page de garde). */
  skipFirst?: boolean;
}

interface Placement {
  page: PDFPage;
  /** Largeur et hauteur de la page telle qu'affichée. */
  width: number;
  height: number;
  rotation: number;
  /** Point affiché (depuis le coin supérieur gauche, y vers le bas) → espace PDF. */
  toPdf: (dx: number, dy: number) => Point;
}

export function placement(page: PDFPage): Placement {
  const box = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const { right, down } = screenAxes(rotation);
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  // Coin de la page qui apparaît en haut à gauche à l'écran.
  const origins: Record<number, Point> = {
    0: [box.x, box.y + box.height],
    90: [box.x, box.y],
    180: [box.x + box.width, box.y],
    270: [box.x + box.width, box.y + box.height],
  };
  const origin = origins[rotation];
  return {
    page,
    width,
    height,
    rotation,
    toPdf: (dx, dy) => addScaled(addScaled(origin, right, dx), down, dy),
  };
}

function color(hex: string) {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
}

function ensureEncodable(font: PDFFont, text: string) {
  try {
    font.encodeText(text);
  } catch {
    throw new Error(`Caractère non pris en charge dans « ${text} » (police standard, alphabet latin uniquement).`);
  }
}

/** Écrit une ligne de texte à une position d'écran, alignée à gauche, au centre ou à droite. */
function drawLine(p: Placement, font: PDFFont, text: string, size: number, dx: number, dy: number, align: HAlign, hex: string, opacity = 1) {
  if (!text) return;
  ensureEncodable(font, text);
  const w = font.widthOfTextAtSize(text, size);
  const startX = align === "left" ? dx : align === "center" ? dx - w / 2 : dx - w;
  const [x, y] = p.toPdf(startX, dy);
  p.page.drawText(text, { x, y, size, font, color: color(hex), opacity, rotate: degrees(p.rotation) });
}

/** Remplace {page}, {total}, {date} et {titre}. */
export function fillTemplate(template: string, page: number, total: number, title = ""): string {
  const date = new Date().toLocaleDateString("fr-FR");
  return template
    .replaceAll("{page}", String(page))
    .replaceAll("{total}", String(total))
    .replaceAll("{date}", date)
    .replaceAll("{titre}", title);
}

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

// ---------------------------------------------------------------------------

export interface PageNumberOptions extends PageRange {
  /** Ex. « {page} », « Page {page} / {total} ». */
  format: string;
  vertical: VAlign;
  horizontal: HAlign;
  start: number;
  size: number;
  color: string;
  margin: number;
}

export async function addPageNumbers(bytes: Uint8Array, o: PageNumberOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const counted = o.skipFirst ? pages.length - 1 : pages.length;
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const n = o.start + (o.skipFirst ? i - 1 : i);
    const p = placement(page);
    const dx = o.horizontal === "left" ? o.margin : o.horizontal === "center" ? p.width / 2 : p.width - o.margin;
    const dy = o.vertical === "top" ? o.margin + o.size : p.height - o.margin;
    drawLine(p, font, fillTemplate(o.format, n, counted + o.start - 1), o.size, dx, dy, o.horizontal, o.color);
  });
  return doc.save();
}

// ---------------------------------------------------------------------------

export interface HeaderFooterOptions extends PageRange {
  header: [string, string, string];
  footer: [string, string, string];
  size: number;
  color: string;
  margin: number;
}

export async function addHeaderFooter(bytes: Uint8Array, o: HeaderFooterOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const title = doc.getTitle() ?? "";
  const pages = doc.getPages();
  const aligns: HAlign[] = ["left", "center", "right"];
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const p = placement(page);
    const xs = [o.margin, p.width / 2, p.width - o.margin];
    for (let k = 0; k < 3; k++) {
      drawLine(p, font, fillTemplate(o.header[k], i + 1, pages.length, title), o.size, xs[k], o.margin + o.size, aligns[k], o.color);
      drawLine(p, font, fillTemplate(o.footer[k], i + 1, pages.length, title), o.size, xs[k], p.height - o.margin, aligns[k], o.color);
    }
  });
  return doc.save();
}

// ---------------------------------------------------------------------------

export interface WatermarkOptions extends PageRange {
  text: string;
  size: number;
  color: string;
  opacity: number;
  /** Diagonale montante (45°) ou horizontale. */
  diagonal: boolean;
}

export async function addWatermark(bytes: Uint8Array, o: WatermarkOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  ensureEncodable(font, o.text);
  doc.getPages().forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const p = placement(page);
    // Taille réduite si le texte dépasse la diagonale (ou la largeur) de la page.
    const span = o.diagonal ? Math.hypot(p.width, p.height) * 0.85 : p.width * 0.9;
    const size = Math.min(o.size, (o.size * span) / font.widthOfTextAtSize(o.text, o.size));
    const w = font.widthOfTextAtSize(o.text, size);
    const angle = o.diagonal ? 45 : 0;
    // Direction du texte à l'écran (montante pour la diagonale), puis vers l'espace PDF.
    const rad = (angle * Math.PI) / 180;
    const center: Point = [p.width / 2, p.height / 2];
    const startScreen: Point = [
      center[0] - (Math.cos(rad) * w) / 2 + (Math.sin(rad) * size * 0.35),
      center[1] + (Math.sin(rad) * w) / 2 + (Math.cos(rad) * size * 0.35),
    ];
    const [x, y] = p.toPdf(startScreen[0], startScreen[1]);
    page.drawText(o.text, {
      x,
      y,
      size,
      font,
      color: color(o.color),
      opacity: o.opacity,
      rotate: degrees(p.rotation + angle),
    });
  });
  return doc.save();
}
