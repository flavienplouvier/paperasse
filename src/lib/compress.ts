import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";
import { IDENTITY, mul, parseOps, type Matrix } from "./pdfContent";

/**
 * Compression d'un PDF, entièrement sur l'appareil.
 *
 * - Sans perte (toujours) : objets inutilisés supprimés, flux non compressés
 *   compressés (Flate), objets regroupés en flux d'objets.
 * - Images (niveaux « recommandé » et « forte ») : chaque image est ramenée à la
 *   résolution utile d'après la taille à laquelle elle est réellement affichée
 *   sur les pages, puis réencodée en JPEG. Une image n'est remplacée que si le
 *   résultat est nettement plus léger.
 */

export type CompressionLevel = "lossless" | "balanced" | "strong";

export const COMPRESSION_LEVELS: Record<CompressionLevel, { label: string; detail: string; dpi?: number; quality?: number }> = {
  lossless: { label: "Sans perte", detail: "Aucune modification visible. Gain souvent modeste." },
  balanced: {
    label: "Recommandée",
    detail: "Images ramenées à 150 ppp : parfait à l'écran et à l'impression courante.",
    dpi: 150,
    quality: 0.75,
  },
  strong: {
    label: "Forte",
    detail: "Images à 96 ppp et JPEG plus compressé : idéal pour l'envoi par e-mail ou un portail limité en taille.",
    dpi: 96,
    quality: 0.6,
  },
};

/** Image à réencoder : JPEG d'origine, ou pixels bruts (1 ou 3 composantes, 8 bits). */
export type ImageSource = { jpeg: Uint8Array } | { pixels: Uint8Array; width: number; height: number; channels: 1 | 3 };

/** Réencode une image en JPEG RVB à la taille demandée (fourni par le navigateur : canvas). */
export type ImageEncoder = (src: ImageSource, width: number, height: number, quality: number) => Promise<Uint8Array | null>;

export interface CompressionReport {
  before: number;
  after: number;
  /** Images réduites ou réencodées. */
  images: number;
  /** Images examinées. */
  imagesSeen: number;
  /** Objets inutilisés supprimés. */
  removedObjects: number;
}

// ------------------------------------------------------------------ utilitaires

const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);
const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);

function streamBytes(doc: PDFDocument, o: PDFObject | undefined): Uint8Array | undefined {
  const s = doc.context.lookup(o);
  if (!(s instanceof PDFRawStream)) return undefined;
  try {
    return decodePDFRawStream(s).decode();
  } catch {
    return undefined;
  }
}

function contentsOf(doc: PDFDocument, page: PDFDict): Uint8Array {
  const raw = page.get(PDFName.of("Contents"));
  const c = doc.context.lookup(raw);
  const list = c instanceof PDFArray ? c.asArray() : raw ? [raw] : [];
  const parts = list.map((r) => streamBytes(doc, r) ?? new Uint8Array());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    out[at + p.length] = 10;
    at += p.length + 1;
  }
  return out;
}

// ------------------------------------------------------------------ taille d'affichage des images

/**
 * Pour chaque image (par référence), la plus grande taille à laquelle elle est
 * affichée, en points. Les images absentes de la carte (motifs, apparences
 * d'annotations…) ne sont pas touchées.
 */
export function imageDisplaySizes(doc: PDFDocument): Map<PDFRef, { w: number; h: number }> {
  const sizes = new Map<PDFRef, { w: number; h: number }>();
  let budget = 5000; // garde-fou contre les formulaires imbriqués à l'infini

  const walk = (content: Uint8Array, resources: PDFDict | undefined, base: Matrix, depth: number) => {
    const xobjects = resources ? doc.context.lookup(resources.get(PDFName.of("XObject"))) : undefined;
    let ctm = base;
    const stack: Matrix[] = [];
    for (const o of parseOps(content)) {
      if (o.op === "q") stack.push(ctm);
      else if (o.op === "Q") ctm = stack.pop() ?? ctm;
      else if (o.op === "cm" && o.args.length === 6 && o.args.every((a) => typeof a === "number")) {
        ctm = mul(o.args as unknown as Matrix, ctm);
      } else if (o.op === "Do" && xobjects instanceof PDFDict && budget-- > 0) {
        const n = o.args[0];
        if (!n || typeof n !== "object" || !("name" in n)) continue;
        const ref = xobjects.get(PDFName.of(n.name));
        const x = doc.context.lookup(ref);
        if (!(x instanceof PDFStream)) continue;
        const subtype = nameOf(x.dict.get(PDFName.of("Subtype")));
        if (subtype === "Image" && ref instanceof PDFRef) {
          const w = Math.hypot(ctm[0], ctm[1]);
          const h = Math.hypot(ctm[2], ctm[3]);
          const prev = sizes.get(ref);
          sizes.set(ref, { w: Math.max(w, prev?.w ?? 0), h: Math.max(h, prev?.h ?? 0) });
        } else if (subtype === "Form" && depth < 8) {
          const m = doc.context.lookup(x.dict.get(PDFName.of("Matrix")));
          const matrix = m instanceof PDFArray && m.size() === 6 ? (m.asArray().map((v) => num(v) ?? 0) as Matrix) : IDENTITY;
          const res = doc.context.lookup(x.dict.get(PDFName.of("Resources")));
          const bytes = streamBytes(doc, ref);
          if (bytes) walk(bytes, res instanceof PDFDict ? res : resources, mul(matrix, ctm), depth + 1);
        }
      }
    }
  };

  for (const page of doc.getPages()) {
    try {
      walk(contentsOf(doc, page.node), page.node.Resources(), IDENTITY, 0);
    } catch {
      /* page illisible : ses images restent telles quelles */
    }
  }
  return sizes;
}

// ------------------------------------------------------------------ images

/** Annule les prédicteurs PNG (DecodeParms /Predictor ≥ 10) d'une image 8 bits. */
export function unpredictPng(data: Uint8Array, columns: number, colors: number): Uint8Array | undefined {
  const bpp = colors;
  const row = columns * colors;
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)];
    const src = y * (row + 1) + 1;
    const dst = y * row;
    for (let x = 0; x < row; x++) {
      const raw = data[src + x];
      const left = x >= bpp ? out[dst + x - bpp] : 0;
      const up = y > 0 ? out[dst - row + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[dst - row + x - bpp] : 0;
      let v: number;
      switch (type) {
        case 0:
          v = raw;
          break;
        case 1:
          v = raw + left;
          break;
        case 2:
          v = raw + up;
          break;
        case 3:
          v = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return undefined;
      }
      out[dst + x] = v & 255;
    }
  }
  return out;
}

/** Nombre de composantes d'un espace colorimétrique pris en charge (1 ou 3), sinon undefined. */
function components(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | undefined {
  const o = doc.context.lookup(cs);
  const n = nameOf(o);
  if (n === "DeviceGray" || n === "CalGray") return 1;
  if (n === "DeviceRGB" || n === "CalRGB") return 3;
  if (o instanceof PDFArray) {
    const kind = nameOf(doc.context.lookup(o.get(0)));
    if (kind === "ICCBased") {
      const icc = doc.context.lookup(o.get(1));
      const nn = icc instanceof PDFStream ? num(icc.dict.get(PDFName.of("N"))) : undefined;
      return nn === 1 ? 1 : nn === 3 ? 3 : undefined;
    }
    if (kind === "CalRGB") return 3;
    if (kind === "CalGray") return 1;
  }
  return undefined;
}

interface Candidate {
  source: ImageSource;
  width: number;
  height: number;
  channels: 1 | 3;
  jpeg: boolean;
}

/** Image réencodable : 8 bits, gris ou RVB, sans masque ni tableau Decode, Flate ou JPEG. */
function candidate(doc: PDFDocument, s: PDFRawStream): Candidate | undefined {
  const d = s.dict;
  const get = (k: string) => doc.context.lookup(d.get(PDFName.of(k)));
  if (get("ImageMask") || get("Decode") || get("Mask") instanceof PDFArray) return undefined;
  const width = num(get("Width"));
  const height = num(get("Height"));
  if (!width || !height || width * height < 4096) return undefined;
  if (num(get("BitsPerComponent")) !== 8) return undefined;
  const channels = components(doc, d.get(PDFName.of("ColorSpace")));
  if (!channels) return undefined;
  const filterObj = get("Filter");
  const filters = filterObj instanceof PDFArray ? filterObj.asArray().map((f) => nameOf(doc.context.lookup(f))) : [nameOf(filterObj)];
  if (filters.length !== 1) return undefined;
  if (filters[0] === "DCTDecode") {
    return { source: { jpeg: s.getContents() }, width, height, channels, jpeg: true };
  }
  if (filters[0] !== "FlateDecode" && filters[0] !== undefined) return undefined;
  let pixels: Uint8Array;
  try {
    pixels = decodePDFRawStream(s).decode();
  } catch {
    return undefined;
  }
  const parms = get("DecodeParms");
  const predictor = parms instanceof PDFDict ? num(doc.context.lookup(parms.get(PDFName.of("Predictor")))) ?? 1 : 1;
  if (predictor >= 10) {
    const un = unpredictPng(pixels, width, channels);
    if (!un) return undefined;
    pixels = un;
  } else if (predictor !== 1) return undefined;
  if (pixels.length < width * height * channels) return undefined;
  return { source: { pixels, width, height, channels }, width, height, channels, jpeg: false };
}

// ------------------------------------------------------------------ sans perte

/** Supprime les objets que plus rien ne référence (pages supprimées, anciennes versions…). */
function removeUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const pending: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean) as PDFObject[];
  while (pending.length) {
    const o = pending.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = ctx.lookup(o);
      if (v) pending.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) pending.push(v);
    } else if (o instanceof PDFArray) {
      pending.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      pending.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref)) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Compresse (Flate) les flux qui ne l'étaient pas. */
function deflateRawStreams(doc: PDFDocument) {
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(PDFName.of("Filter"))) continue;
    const contents = obj.getContents();
    if (contents.length < 128) continue;
    const dict: Record<string, PDFObject> = {};
    for (const [k, v] of obj.dict.entries()) {
      const key = k.decodeText();
      if (key !== "Length" && key !== "DecodeParms") dict[key] = v;
    }
    const flate = ctx.flateStream(contents, dict);
    if (flate.getContents().length < contents.length) ctx.assign(ref, flate);
  }
}

// ------------------------------------------------------------------ point d'entrée

export async function compressPdf(
  bytes: Uint8Array,
  level: CompressionLevel,
  encode?: ImageEncoder,
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; report: CompressionReport }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const report: CompressionReport = { before: bytes.length, after: bytes.length, images: 0, imagesSeen: 0, removedObjects: 0 };
  const settings = COMPRESSION_LEVELS[level];

  if (settings.dpi && settings.quality && encode) {
    const sizes = imageDisplaySizes(doc);
    const entries = [...sizes];
    for (const [k, [ref, shown]] of entries.entries()) {
      onProgress?.(k, entries.length);
      const s = doc.context.lookup(ref);
      if (!(s instanceof PDFRawStream)) continue;
      const c = candidate(doc, s);
      if (!c) continue;
      report.imagesSeen++;
      // Résolution utile : taille affichée (en pouces) × ppp visés, jamais au-delà de l'original.
      const scale = Math.min(1, Math.max((shown.w / 72) * settings.dpi / c.width, (shown.h / 72) * settings.dpi / c.height));
      const width = Math.max(1, Math.round(c.width * scale));
      const height = Math.max(1, Math.round(c.height * scale));
      // En « recommandée », une image déjà à la bonne taille n'est pas réencodée (pas de perte inutile).
      if (level === "balanced" && scale > 0.9) continue;
      let jpeg: Uint8Array | null = null;
      try {
        jpeg = await encode(c.source, width, height, settings.quality);
      } catch {
        jpeg = null;
      }
      const old = s.getContents().length;
      if (!jpeg || jpeg.length > old * 0.85) continue;
      const dict: Record<string, PDFObject | string | number> = {
        Type: "XObject",
        Subtype: "Image",
        Width: width,
        Height: height,
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      };
      // Le JPEG produit est en RVB : on garde l'espace d'origine s'il est RVB, sinon DeviceRGB.
      const cs = s.dict.get(PDFName.of("ColorSpace"));
      dict.ColorSpace = c.channels === 3 && cs ? cs : "DeviceRGB";
      for (const key of ["SMask", "Mask", "Interpolate", "Intent", "OC", "Metadata", "Alternates"]) {
        const v = s.dict.get(PDFName.of(key));
        if (v) dict[key] = v;
      }
      doc.context.assign(ref, doc.context.stream(jpeg, dict));
      report.images++;
    }
    onProgress?.(entries.length, entries.length);
  }

  report.removedObjects = removeUnreachable(doc);
  deflateRawStreams(doc);
  const out = await doc.save({ useObjectStreams: true });
  // Jamais plus gros que l'original.
  if (out.length >= bytes.length) return { bytes, report: { ...report, after: bytes.length } };
  return { bytes: out, report: { ...report, after: out.length } };
}

/** « 1,4 Mo », « 820 Ko ». */
export function formatSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  return `${Math.max(1, Math.round(n / 1024)).toLocaleString("fr-FR")} Ko`;
}
