import { PDFDocument, degrees } from "pdf-lib";
import { newId } from "./types";
import { normalizeRotation } from "./geometry";

export interface PagesResult {
  bytes: Uint8Array;
  pageIds: string[];
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/**
 * Construit un nouveau document à partir d'une liste ordonnée de pages
 * (indices dans le document source). Sert à supprimer, réorganiser, dupliquer
 * et extraire des pages en conservant leur contenu (polices, images, liens).
 */
export async function rebuild(
  bytes: Uint8Array,
  order: { index: number; id: string }[],
): Promise<PagesResult> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  copyMetadata(src, out);
  const copied = await out.copyPages(
    src,
    order.map((o) => o.index),
  );
  copied.forEach((p) => out.addPage(p));
  return { bytes: await out.save(), pageIds: order.map((o) => o.id) };
}

function copyMetadata(src: PDFDocument, out: PDFDocument) {
  const title = src.getTitle();
  const author = src.getAuthor();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  out.setProducer("Feuillet PDF");
}

export async function deletePages(bytes: Uint8Array, pageIds: string[], remove: Set<string>) {
  const order = pageIds.map((id, index) => ({ id, index })).filter((p) => !remove.has(p.id));
  if (order.length === 0) throw new Error("Un PDF doit contenir au moins une page.");
  return rebuild(bytes, order);
}

export async function movePage(bytes: Uint8Array, pageIds: string[], from: number, to: number) {
  const order = pageIds.map((id, index) => ({ id, index }));
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return rebuild(bytes, order);
}

export async function duplicatePage(bytes: Uint8Array, pageIds: string[], at: number) {
  const order = pageIds.map((id, index) => ({ id, index }));
  order.splice(at + 1, 0, { id: newId("page"), index: at });
  return rebuild(bytes, order);
}

/** Les ids conservés restent valides : les annotations restent attachées. */
export async function rotatePages(bytes: Uint8Array, pageIds: string[], ids: Set<string>, delta: number) {
  const doc = await load(bytes);
  doc.getPages().forEach((page, i) => {
    if (ids.has(pageIds[i])) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + delta)));
    }
  });
  return { bytes: await doc.save(), pageIds: [...pageIds] };
}

export async function insertBlankPage(bytes: Uint8Array, pageIds: string[], at: number) {
  const doc = await load(bytes);
  const ref = doc.getPage(Math.max(0, Math.min(at, doc.getPageCount() - 1)));
  const { width, height } = ref.getSize();
  doc.insertPage(at + 1, [width, height]);
  const ids = [...pageIds];
  ids.splice(at + 1, 0, newId("page"));
  return { bytes: await doc.save(), pageIds: ids };
}

/** Ajoute à la fin toutes les pages d'autres PDF (fusion). */
export async function appendDocuments(bytes: Uint8Array, pageIds: string[], others: Uint8Array[]) {
  const doc = await load(bytes);
  const ids = [...pageIds];
  for (const other of others) {
    const src = await load(other);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => {
      doc.addPage(p);
      ids.push(newId("page"));
    });
  }
  return { bytes: await doc.save(), pageIds: ids };
}

/** Nouveau PDF ne contenant que les pages choisies (extraction / découpage). */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  copyMetadata(src, out);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/** Convertit des images PNG/JPEG en PDF, une image par page. */
export async function imagesToPdf(images: { bytes: Uint8Array; type: string }[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setProducer("Feuillet PDF");
  for (const img of images) {
    const embedded = img.type.includes("png") ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes);
    const page = out.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  return out.save();
}

export function freshPageIds(count: number): string[] {
  return Array.from({ length: count }, () => newId("page"));
}
