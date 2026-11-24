import { msg, t } from "../i18n";

/**
 * Enregistrement d'un document numérisé en images (une image par page) :
 * chaque page du PDF final (annotations comprises) est rendue puis encodée.
 */

export type SaveFormat = "pdf" | "avif" | "webp" | "heic" | "png" | "jpg";

export interface FormatInfo {
  id: SaveFormat;
  label: string;
  ext: string;
  mime: string;
  /** Explication simple (affichée au survol ou dans la fenêtre d'aide). */
  help: string;
}

export const SAVE_FORMATS: FormatInfo[] = [
  { id: "pdf", label: "PDF", ext: "pdf", mime: "application/pdf", help: msg("Le format des documents : toutes les pages dans un seul fichier, lisible partout. Le meilleur choix pour envoyer ou archiver.") },
  { id: "avif", label: "AVIF", ext: "avif", mime: "image/avif", help: msg("Image moderne très légère, de bonne qualité. Lue par les navigateurs et appareils récents, pas toujours par les anciens logiciels.") },
  { id: "webp", label: "WebP", ext: "webp", mime: "image/webp", help: msg("Image légère conçue pour le web, bien reconnue aujourd'hui. Un bon compromis entre poids et compatibilité.") },
  { id: "heic", label: "HEIC", ext: "heic", mime: "image/heic", help: msg("Le format photo des iPhone, très léger. Surtout pratique dans l'univers Apple ; ailleurs il faut parfois le convertir.") },
  { id: "png", label: "PNG", ext: "png", mime: "image/png", help: msg("Image sans aucune perte de qualité : texte bien net, mais fichier lourd.") },
  { id: "jpg", label: "JPG", ext: "jpg", mime: "image/jpeg", help: msg("La photo classique, lue par tous les appareils et logiciels. Fichier de taille moyenne.") },
];

export const formatInfo = (id: SaveFormat) => SAVE_FORMATS.find((f) => f.id === id)!;

const QUALITY: Partial<Record<SaveFormat, number>> = { jpg: 0.88, webp: 0.85, heic: 0.8 };

/** Le navigateur sait-il produire ce format lui-même (canvas) ? Il renvoie du PNG sinon. */
function canvasEncodes(mime: string): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return new Promise((res) => c.toBlob((b) => res(!!b && b.type === mime), mime));
}

const support = new Map<SaveFormat, Promise<boolean>>();

/** Formats que cet appareil sait produire (l'AVIF a un encodeur intégré à l'application). */
export function canSave(format: SaveFormat): Promise<boolean> {
  if (format === "pdf" || format === "png" || format === "jpg") return Promise.resolve(true);
  if (!support.has(format)) {
    const mime = formatInfo(format).mime;
    support.set(format, format === "avif" ? canvasEncodes(mime).then((ok) => ok || typeof WebAssembly === "object") : canvasEncodes(mime));
  }
  return support.get(format)!;
}

async function encode(canvas: HTMLCanvasElement, format: SaveFormat): Promise<Blob> {
  const { mime } = formatInfo(format);
  if (await canvasEncodes(mime)) {
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(t("Encodage de l'image impossible.")))), mime, QUALITY[format]));
  }
  if (format === "avif") {
    // Encodeur AVIF (WebAssembly), chargé seulement quand on en a besoin.
    const { default: avif } = await import("@jsquash/avif/encode");
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return new Blob([await avif(data, { quality: 60, speed: 8 })], { type: mime });
  }
  throw new Error(t("Ce navigateur ne sait pas enregistrer au format {format}.", { format: formatInfo(format).label }));
}

/** Nom de chaque image : « Scan.jpg », ou « Scan-1.jpg », « Scan-2.jpg »… */
export function imageNames(fileName: string, count: number, format: SaveFormat): string[] {
  const base = fileName.replace(/\.pdf$/i, "");
  const { ext } = formatInfo(format);
  return count === 1 ? [`${base}.${ext}`] : Array.from({ length: count }, (_, i) => `${base}-${i + 1}.${ext}`);
}

/** Rend chaque page du PDF (grand côté ≈ 2200 px, comme la numérisation) et l'encode. */
export async function pdfToImages(bytes: Uint8Array, format: SaveFormat, onProgress?: (done: number, total: number) => void): Promise<Blob[]> {
  const { openPdf } = await import("./pdfjs");
  const pdf = await openPdf(bytes);
  try {
    const out: Blob[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const flat = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 2200 / Math.max(flat.width, flat.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: format === "avif" })!;
      // Fond blanc : les formats sans transparence (JPG) ne noircissent pas les zones vides.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      out.push(await encode(canvas, format));
      canvas.width = canvas.height = 0;
      onProgress?.(i, pdf.numPages);
    }
    return out;
  } finally {
    void pdf.loadingTask.destroy();
  }
}
