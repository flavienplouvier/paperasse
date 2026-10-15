import {
  PDFDocument,
  type PDFFont,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from "pdf-lib";
import type { Point } from "./types";

/**
 * Mot reconnu par l'OCR, déjà converti dans l'espace PDF de sa page :
 * segment de ligne de base (début → fin du mot) et hauteur du mot.
 */
export interface OcrWord {
  text: string;
  start: Point;
  end: Point;
  /** Hauteur du mot en points PDF. */
  height: number;
}

/** Garde les caractères que la police standard sait écrire (alphabet latin). */
function encodable(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/**
 * Ajoute le texte reconnu sous forme de texte invisible (mode de rendu 3),
 * placé et étiré pour recouvrir exactement chaque mot de l'image. Le PDF
 * devient cherchable, sélectionnable et copiable sans changer d'aspect —
 * comme les PDF « avec reconnaissance de texte » des scanners et d'Acrobat.
 */
export async function addInvisibleText(bytes: Uint8Array, pages: Map<number, OcrWord[]>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  for (const [index, words] of pages) {
    const page = all[index];
    if (!page || !words.length) continue;
    page.node.normalize();
    const key = page.node.newFontDictionary("PaOCR", font.ref);
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of words) {
      const text = encodable(font, w.text.trim());
      if (!text) continue;
      const dx = w.end[0] - w.start[0];
      const dy = w.end[1] - w.start[1];
      const width = Math.hypot(dx, dy);
      if (width < 0.5 || w.height < 1) continue;
      const size = w.height * 0.9;
      const natural = font.widthOfTextAtSize(text, size);
      const squeeze = Math.max(10, Math.min(1000, (width / natural) * 100));
      const cos = dx / width;
      const sin = dy / width;
      ops.push(
        setFontAndSize(key, size),
        setCharacterSqueeze(squeeze),
        setTextMatrix(cos, sin, -sin, cos, w.start[0], w.start[1]),
        showText(font.encodeText(text)),
      );
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  return doc.save();
}
