import type { Annotation } from "./types";

/**
 * Sauvegarde automatique du travail en cours dans le navigateur (IndexedDB),
 * pour le reprendre après une fermeture d'onglet ou un rechargement — fréquent
 * sur téléphone. Rien ne quitte l'appareil.
 */
export interface Draft {
  name: string;
  bytes: Uint8Array;
  pageIds: string[];
  annotations: Annotation[];
  rewritable: boolean;
  savedAt: number;
  /** Polices incorporées utilisées par l'aperçu (famille CSS → données). */
  faces: Record<string, Uint8Array>;
  /** Polices importées par l'utilisateur (nom → octets). */
  importedFonts: Record<string, ArrayBuffer>;
}

export type DraftInfo = Pick<Draft, "name" | "savedAt"> & { pages: number; edits: number };

const DB = "paperasse";
const STORE = "drafts";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function saveDraft(draft: Draft): Promise<unknown> {
  return run("readwrite", (s) => s.put(draft, KEY));
}

export function loadDraft(): Promise<Draft | undefined> {
  return run("readonly", (s) => s.get(KEY) as IDBRequest<Draft | undefined>);
}

export function clearDraft(): Promise<unknown> {
  return run("readwrite", (s) => s.delete(KEY));
}

export function draftInfo(d: Draft): DraftInfo {
  return { name: d.name, savedAt: d.savedAt, pages: d.pageIds.length, edits: d.annotations.length };
}

export function formatSavedAt(t: number): string {
  const date = new Date(t);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return today ? `aujourd'hui à ${time}` : `le ${date.toLocaleDateString("fr-FR")} à ${time}`;
}
