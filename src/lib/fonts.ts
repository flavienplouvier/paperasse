import { StandardFonts } from "pdf-lib";

/**
 * Registre des polices utilisables pour écrire dans un PDF :
 *  - les 12 polices standard PDF (toujours disponibles, alphabet latin) ;
 *  - les polices installées sur l'ordinateur (API Local Font Access,
 *    Chrome/Edge de bureau) ;
 *  - les fichiers TTF/OTF importés par l'utilisateur (tous appareils, Android compris).
 * Les polices non standard sont intégrées (sous-ensemble) dans le PDF exporté,
 * ce qui permet n'importe quel alphabet couvert par la police.
 */
export interface FontEntry {
  key: string;
  label: string;
  source: "standard" | "local" | "file";
  /** Famille CSS utilisée pour l'aperçu à l'écran. */
  cssFamily: string;
  standard?: StandardFonts;
  postscriptName?: string;
  family?: string;
  style?: string;
  load?: () => Promise<ArrayBuffer>;
}

const SANS = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const SERIF = "'Times New Roman', Times, 'Liberation Serif', serif";
const MONO = "'Courier New', Courier, 'Liberation Mono', monospace";

const STANDARD: [StandardFonts, string, string][] = [
  [StandardFonts.Helvetica, "Helvetica", SANS],
  [StandardFonts.HelveticaBold, "Helvetica Gras", SANS],
  [StandardFonts.HelveticaOblique, "Helvetica Italique", SANS],
  [StandardFonts.HelveticaBoldOblique, "Helvetica Gras Italique", SANS],
  [StandardFonts.TimesRoman, "Times", SERIF],
  [StandardFonts.TimesRomanBold, "Times Gras", SERIF],
  [StandardFonts.TimesRomanItalic, "Times Italique", SERIF],
  [StandardFonts.TimesRomanBoldItalic, "Times Gras Italique", SERIF],
  [StandardFonts.Courier, "Courier", MONO],
  [StandardFonts.CourierBold, "Courier Gras", MONO],
  [StandardFonts.CourierOblique, "Courier Italique", MONO],
  [StandardFonts.CourierBoldOblique, "Courier Gras Italique", MONO],
];

export const DEFAULT_FONT_KEY = `std:${StandardFonts.Helvetica}`;

const registry = new Map<string, FontEntry>();
for (const [std, label, css] of STANDARD) {
  registry.set(`std:${std}`, { key: `std:${std}`, label, source: "standard", cssFamily: css, standard: std });
}

const listeners = new Set<() => void>();
let snapshot: FontEntry[] = [...registry.values()];

function changed() {
  snapshot = [...registry.values()];
  listeners.forEach((l) => l());
}

export function subscribeFonts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFonts(): FontEntry[] {
  return snapshot;
}

export function getFont(key: string): FontEntry {
  return registry.get(key) ?? registry.get(DEFAULT_FONT_KEY)!;
}

export function standardStyle(key: string): { bold: boolean; italic: boolean } {
  return { bold: /Bold/.test(key), italic: /Oblique|Italic/.test(key) };
}

// ---------------------------------------------------------------------------
// Polices installées (Local Font Access API)

interface LocalFontData {
  postscriptName: string;
  fullName: string;
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

export function localFontsSupported(): boolean {
  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

/** Demande l'accès aux polices de l'ordinateur et les ajoute au registre. */
export async function loadLocalFonts(): Promise<number> {
  if (!localFontsSupported()) {
    throw new Error(
      "Ce navigateur ne donne pas accès aux polices installées (disponible sur Chrome et Edge pour ordinateur). Importez un fichier TTF/OTF à la place.",
    );
  }
  const query = (window as unknown as { queryLocalFonts: () => Promise<LocalFontData[]> }).queryLocalFonts;
  const fonts = await query();
  let added = 0;
  for (const f of fonts) {
    const key = `local:${f.postscriptName}`;
    if (registry.has(key)) continue;
    registry.set(key, {
      key,
      label: f.fullName,
      source: "local",
      cssFamily: `"fl-${cssSafe(f.postscriptName)}"`,
      postscriptName: f.postscriptName,
      family: f.family,
      style: f.style,
      load: async () => (await f.blob()).arrayBuffer(),
    });
    added += 1;
  }
  changed();
  return added;
}

// ---------------------------------------------------------------------------
// Fichiers de police importés

/**
 * Ajoute une police à partir de ses octets. `postscriptName` choisit la police
 * voulue dans une collection .ttc ; sinon la première est utilisée.
 */
export function registerFontBytes(name: string, buffer: ArrayBuffer, postscriptName?: string): string {
  const key = `file:${name}:${buffer.byteLength}`;
  registry.set(key, {
    key,
    label: `${name} (importée)`,
    source: "file",
    cssFamily: `"fl-${cssSafe(key)}"`,
    postscriptName,
    family: name,
    load: async () => buffer,
  });
  changed();
  return key;
}

export async function addFontFiles(files: Iterable<File>): Promise<string[]> {
  const keys: string[] = [];
  for (const file of files) {
    const name = file.name.replace(/\.(ttf|otf|ttc|otc)$/i, "");
    const key = registerFontBytes(name, await file.arrayBuffer());
    keys.push(key);
    await ensureCssFont(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Chargement

const bytesCache = new Map<string, Promise<ArrayBuffer>>();
const cssLoaded = new Set<string>();

export function fontBytes(key: string): Promise<ArrayBuffer> {
  const entry = getFont(key);
  if (!entry.load) return Promise.reject(new Error("Police standard : pas de fichier à intégrer."));
  let p = bytesCache.get(key);
  if (!p) {
    p = entry.load();
    bytesCache.set(key, p);
  }
  return p;
}

/** Enregistre la police auprès du navigateur pour l'aperçu à l'écran. */
export async function ensureCssFont(key: string): Promise<void> {
  const entry = getFont(key);
  if (entry.source === "standard" || cssLoaded.has(key)) return;
  const family = entry.cssFamily.replace(/"/g, "");
  const face = new FontFace(family, await fontBytes(key));
  await face.load();
  document.fonts.add(face);
  cssLoaded.add(key);
}

function cssSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------------------
// Correspondance avec la police d'origine d'un PDF

/** "ABCDEF+Calibri-BoldItalic" → "calibribolditalic" */
export function normalizeFontName(name: string): string {
  return name
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/(PS|MT|PSMT)$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/**
 * Trouve, parmi les polices disponibles, celle qui correspond le mieux au nom
 * de police trouvé dans le PDF. Retourne la police standard la plus proche sinon.
 */
export function matchFont(pdfFontName: string | undefined, fonts: FontEntry[] = snapshot): string {
  if (!pdfFontName) return DEFAULT_FONT_KEY;
  const wanted = normalizeFontName(pdfFontName);
  const bold = /bold|black|heavy|semibold|demi/i.test(pdfFontName);
  const italic = /italic|oblique/i.test(pdfFontName);

  let best: { key: string; score: number } | undefined;
  for (const f of fonts) {
    if (f.source === "standard") continue;
    const candidates = [f.postscriptName, f.label, `${f.family ?? ""}${f.style ?? ""}`]
      .filter(Boolean)
      .map((n) => normalizeFontName(n!));
    let score = 0;
    if (candidates.includes(wanted)) score = 100;
    else if (f.family && wanted.startsWith(normalizeFontName(f.family))) {
      score = 50;
      const st = (f.style ?? "").toLowerCase();
      if (bold === /bold|black|heavy|semibold|demi/.test(st)) score += 10;
      if (italic === /italic|oblique/.test(st)) score += 10;
      if (/regular|normal|book|roman/.test(st) && !bold && !italic) score += 5;
    }
    if (score > 0 && (!best || score > best.score)) best = { key: f.key, score };
  }
  if (best) return best.key;

  const lower = pdfFontName.toLowerCase();
  const family = /courier|mono|consol/.test(lower)
    ? "Courier"
    : /times|serif|roman|georgia|garamond|cambria|minion|book/.test(lower) && !/sans/.test(lower)
      ? "Times"
      : "Helvetica";
  const suffix =
    family === "Times"
      ? bold && italic
        ? "-BoldItalic"
        : bold
          ? "-Bold"
          : italic
            ? "-Italic"
            : "-Roman"
      : bold && italic
        ? "-BoldOblique"
        : bold
          ? "-Bold"
          : italic
            ? "-Oblique"
            : "";
  return `std:${family}${suffix}`;
}
