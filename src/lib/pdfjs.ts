import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;

export class PasswordRequired extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? "Mot de passe incorrect." : "Ce PDF est protégé par un mot de passe.");
  }
}

/**
 * Ouvre un PDF pour l'affichage. Les CMaps, polices standard, décodeurs WASM
 * et profils ICC sont fournis pour que toutes les polices et images s'affichent,
 * y compris les PDF asiatiques et les polices non intégrées.
 */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    // pdf.js transfère le tampon au worker : on lui en donne une copie.
    data: bytes.slice(),
    password,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    useSystemFonts: true,
    fontExtraProperties: true,
  });
  try {
    return await task.promise;
  } catch (e) {
    if (e instanceof pdfjs.PasswordException) {
      throw new PasswordRequired(e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    throw e;
  }
}

/**
 * Police réelle d'un fragment de texte (ex. « ABCDEF+Calibri-Bold »), avec les
 * indicateurs gras/italique du descripteur de police. Disponible après rendu.
 */
export function fontInfo(
  page: PDFPageProxy,
  loadedName: string,
): { name?: string; bold?: boolean; italic?: boolean } {
  try {
    const font = page.commonObjs.get(loadedName) as
      | { name?: string; bold?: boolean; black?: boolean; italic?: boolean }
      | undefined;
    return { name: font?.name, bold: !!(font?.bold || font?.black), italic: !!font?.italic };
  } catch {
    return {};
  }
}

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };
