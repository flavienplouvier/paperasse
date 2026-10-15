import { StandardFonts } from "pdf-lib";

/**
 * Registre des polices utilisables pour écrire dans un PDF :
 *  - les 12 polices standard PDF (toujours disponibles, alphabet latin) ;
 *  - les polices installées sur l'ordinateur (API Local Font Access,
 *    Chrome/Edge de bureau) ;
 *  - la bibliothèque de polices libres fournie avec l'application (OFL/Apache),
 *    dont des équivalents métriques des polices Windows/Office ;
 *  - les fichiers TTF/OTF/TTC importés par l'utilisateur (tous appareils, Android compris).
 * Les polices non standard sont intégrées (sous-ensemble) dans le PDF exporté,
 * ce qui permet n'importe quel alphabet couvert par la police.
 */
export interface FontEntry {
  key: string;
  label: string;
  source: "standard" | "local" | "library" | "file";
  /** Famille CSS utilisée pour l'aperçu à l'écran. */
  cssFamily: string;
  standard?: StandardFonts;
  postscriptName?: string;
  family?: string;
  style?: string;
  /** Pour la bibliothèque : metric, sans, serif, mono, script, display. */
  category?: string;
  slug?: string;
  bold?: boolean;
  italic?: boolean;
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
  registry.set(`std:${std}`, {
    key: `std:${std}`,
    label,
    source: "standard",
    cssFamily: css,
    standard: std,
    bold: /Bold/.test(std),
    italic: /Oblique|Italic/.test(std),
  });
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
      bold: BOLD.test(f.style),
      italic: ITALIC.test(f.style),
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
// Bibliothèque de polices libres (public/fonts, préparée par scripts/copy-fonts.mjs)

export interface LibraryFamily {
  slug: string;
  family: string;
  category: string;
  styles: Partial<Record<LibraryStyle, string>>;
}
type LibraryStyle = "regular" | "bold" | "italic" | "boldItalic";

const STYLE_LABEL: Record<LibraryStyle, string> = {
  regular: "",
  bold: " Gras",
  italic: " Italique",
  boldItalic: " Gras italique",
};

/** Ajoute les familles du catalogue au registre (sans télécharger les fichiers). */
export function registerLibrary(catalog: LibraryFamily[], baseUrl: string): void {
  for (const fam of catalog) {
    for (const [style, file] of Object.entries(fam.styles) as [LibraryStyle, string][]) {
      const key = `lib:${fam.slug}:${style}`;
      registry.set(key, {
        key,
        label: `${fam.family}${STYLE_LABEL[style]}`,
        source: "library",
        cssFamily: `"fl-lib-${fam.slug}-${style}"`,
        family: fam.family,
        style,
        slug: fam.slug,
        category: fam.category,
        bold: style === "bold" || style === "boldItalic",
        italic: style === "italic" || style === "boldItalic",
        load: async () => {
          const res = await fetch(`${baseUrl}fonts/${fam.slug}/${file}`);
          if (!res.ok) throw new Error(`Police ${fam.family} indisponible (hors ligne ?).`);
          return res.arrayBuffer();
        },
      });
    }
  }
  changed();
}

let libraryPromise: Promise<void> | null = null;
export function loadLibrary(baseUrl: string): Promise<void> {
  libraryPromise ??= fetch(`${baseUrl}fonts/catalog.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((catalog: LibraryFamily[]) => registerLibrary(catalog, baseUrl))
    .catch(() => undefined);
  return libraryPromise;
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

const BOLD = /bold|black|heavy|semibold|demibold|demi|extrabold|ultrabold/i;
const ITALIC = /italic|oblique|ital|kursiv/i;
const STYLE_WORDS =
  // « Roman » et « Book » n'y figurent pas : ils font souvent partie du nom (TimesNewRoman).
  /(bolditalic|boldoblique|semibolditalic|semibold|demibold|extrabold|ultrabold|bold|black|heavy|italic|oblique|regular|medium|light|thin|condensed|narrow|normal)+$/i;

/** Décompose « ABCDEF+TimesNewRomanPS-BoldItalicMT » → famille « timesnewroman », gras, italique. */
export function parseFontName(name: string): { base: string; bold: boolean; italic: boolean } {
  const clean = name.replace(/^[A-Z]{6}\+/, "").replace(/\s+/g, "");
  const [head, ...rest] = clean.split(/[-,_]/);
  const style = rest.join("");
  let base = head.replace(/(PSMT|PS|MT)$/, "");
  const inline = STYLE_WORDS.exec(base);
  const styleText = `${style}${inline && inline.index > 0 ? inline[0] : ""}`;
  if (inline && inline.index > 0) base = base.slice(0, inline.index);
  base = base.replace(/(PSMT|PS|MT)$/, "");
  return {
    base: base.replace(/[^a-z0-9]/gi, "").toLowerCase(),
    bold: BOLD.test(styleText),
    italic: ITALIC.test(styleText),
  };
}

/**
 * Polices courantes (Windows, Office, macOS, Adobe) → famille libre de la
 * bibliothèque. Les premières sont métriquement compatibles : même largeur
 * de caractères, donc le texte remplacé garde exactement la même longueur.
 */
const ALIASES: Record<string, string> = {
  calibri: "carlito",
  cambria: "caladea",
  arial: "arimo",
  arialmt: "arimo",
  helvetica: "arimo",
  helveticaneue: "arimo",
  liberationsans: "arimo",
  nimbussans: "arimo",
  nimbussansl: "arimo",
  timesnewroman: "tinos",
  times: "tinos",
  timesroman: "tinos",
  liberationserif: "tinos",
  nimbusroman: "tinos",
  couriernew: "cousine",
  courier: "cousine",
  liberationmono: "cousine",
  nimbusmono: "cousine",
  georgia: "gelasio",
  garamond: "eb-garamond",
  adobegaramond: "eb-garamond",
  adobegaramondpro: "eb-garamond",
  segoeui: "open-sans",
  segoe: "open-sans",
  verdana: "noto-sans",
  tahoma: "noto-sans",
  dejavusans: "noto-sans",
  trebuchetms: "fira-sans",
  trebuchet: "fira-sans",
  futura: "jost",
  centurygothic: "jost",
  avenir: "nunito-sans",
  avenirnext: "nunito-sans",
  palatino: "crimson-text",
  palatinolinotype: "crimson-text",
  bookantiqua: "crimson-text",
  consolas: "inconsolata",
  lucidaconsole: "inconsolata",
  menlo: "jetbrains-mono",
  monaco: "jetbrains-mono",
  comicsansms: "comic-neue",
  comicsans: "comic-neue",
  franklingothic: "libre-franklin",
  franklingothicbook: "libre-franklin",
  franklingothicmedium: "libre-franklin",
  gillsans: "cabin",
  rockwell: "zilla-slab",
  baskerville: "libre-baskerville",
  baskervilleoldface: "libre-baskerville",
  bookmanoldstyle: "libre-baskerville",
  myriad: "source-sans-3",
  myriadpro: "source-sans-3",
  sourcesanspro: "source-sans-3",
  minion: "source-serif-4",
  minionpro: "source-serif-4",
  sourceserifpro: "source-serif-4",
  ubuntu: "ubuntu",
  aptos: "open-sans",
  candara: "nunito",
  corbel: "source-sans-3",
  constantia: "spectral",
  bahnschrift: "barlow",
};

function pickStyle(entries: FontEntry[], bold: boolean, italic: boolean): FontEntry | undefined {
  return (
    entries.find((e) => !!e.bold === bold && !!e.italic === italic) ??
    entries.find((e) => !!e.bold === bold) ??
    entries.find((e) => !e.bold && !e.italic) ??
    entries[0]
  );
}

/**
 * Trouve la police disponible la plus fidèle à celle du PDF, dans cet ordre :
 *  1. la même police installée sur l'ordinateur ou importée ;
 *  2. la même famille dans la bibliothèque ;
 *  3. un équivalent (métriquement compatible si possible) de la bibliothèque ;
 *  4. la police standard PDF la plus proche.
 * `hints` complète le nom avec les indicateurs gras/italique lus par pdf.js.
 */
export function matchFont(
  pdfFontName: string | undefined,
  fonts: FontEntry[] = snapshot,
  hints: { bold?: boolean; italic?: boolean } = {},
): string {
  if (!pdfFontName) return DEFAULT_FONT_KEY;
  const parsed = parseFontName(pdfFontName);
  const bold = parsed.bold || !!hints.bold;
  const italic = parsed.italic || !!hints.italic;
  const wanted = normalizeFontName(pdfFontName);

  // 1. Polices de l'utilisateur
  const own = fonts.filter((f) => f.source === "local" || f.source === "file");
  const exact = own.find((f) =>
    [f.postscriptName, f.label].filter(Boolean).some((n) => normalizeFontName(n!) === wanted),
  );
  if (exact) return exact.key;
  const sameFamily = own.filter((f) => f.family && normalizeFontName(f.family) === parsed.base);
  if (sameFamily.length) return pickStyle(sameFamily, bold, italic)!.key;

  // 2 et 3. Bibliothèque
  const library = fonts.filter((f) => f.source === "library");
  if (library.length) {
    const bySlug = (slug: string) => library.filter((f) => f.slug === slug);
    let candidates = library.filter((f) => normalizeFontName(f.family ?? "") === parsed.base);
    if (!candidates.length && ALIASES[parsed.base]) candidates = bySlug(ALIASES[parsed.base]);
    if (!candidates.length) {
      const prefix = Object.keys(ALIASES)
        .filter((a) => a.length >= 5 && parsed.base.startsWith(a))
        .sort((a, b) => b.length - a.length)[0];
      if (prefix) candidates = bySlug(ALIASES[prefix]);
    }
    if (candidates.length) return pickStyle(candidates, bold, italic)!.key;
  }

  // 4. Polices standard (ou leur équivalent de bibliothèque, plus complet en alphabets)
  const lower = pdfFontName.toLowerCase();
  const kind = /courier|mono|consol|code/.test(lower)
    ? "mono"
    : /times|serif|roman|georgia|garamond|cambria|minion|book|antiqua/.test(lower) && !/sans/.test(lower)
      ? "serif"
      : "sans";
  const fallbackSlug = { mono: "cousine", serif: "tinos", sans: "arimo" }[kind];
  const fallback = library.filter((f) => f.slug === fallbackSlug);
  if (fallback.length) return pickStyle(fallback, bold, italic)!.key;

  const std = fonts.filter(
    (f) => f.source === "standard" && f.key.startsWith(`std:${{ mono: "Courier", serif: "Times", sans: "Helvetica" }[kind]}`),
  );
  return (std.length ? pickStyle(std, bold, italic)!.key : null) ?? standardKey(kind, bold, italic);
}

function standardKey(kind: "mono" | "serif" | "sans", bold: boolean, italic: boolean): string {
  if (kind === "serif") return `std:Times-${bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Roman"}`;
  const fam = kind === "mono" ? "Courier" : "Helvetica";
  return `std:${fam}${bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : ""}`;
}
