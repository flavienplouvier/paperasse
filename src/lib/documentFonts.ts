import { getFonts, normalizeFontName, parseFontName, registerFontEntry, type FontEntry } from "./fonts";
import { restoreStateFont, stateFontFor } from "./stateFonts";

/**
 * Police complète d'un document, chargée à la demande depuis une source
 * officielle quand sa licence le permet, pour que les lettres absentes de la
 * police incorporée au PDF soient les vraies — même famille, même graisse :
 *
 *  - Marianne (documents de l'État) : serveur officiel, voir stateFonts.ts ;
 *  - DejaVu (licence libre Bitstream Vera / Arev) : paquet npm dejavu-fonts-ttf ;
 *  - polices libres du catalogue (OFL, Apache) à une graisse que la bibliothèque
 *    n'a pas (Light, Medium, SemiBold, ExtraBold, Black…) : Fontsource, par graisse.
 *
 * Les polices commerciales (Arial, Calibri, Segoe UI…) ne peuvent pas être
 * téléchargées : elles restent remplacées par leur équivalent le plus proche.
 */

export const DEJAVU_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/";
export const FONTSOURCE_URL = "https://cdn.jsdelivr.net/fontsource/fonts/";

const WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/, 100],
  [/extra-?light|ultra-?light/, 200],
  [/semi-?bold|demi-?bold/, 600],
  [/extra-?bold|ultra-?bold|heavy/, 800],
  [/black/, 900],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700],
];

/** Graisse et italique d'un nom de police PDF (« Montserrat-SemiBoldItalic » → 600, italique). */
export function fontWeight(pdfFontName: string, hints: { bold?: boolean; italic?: boolean } = {}): { weight: number; italic: boolean } {
  const name = pdfFontName.replace(/^[A-Z]{6}\+/, "");
  const sep = name.search(/[-,]/);
  // « Famille-Style » ou « Famille,Style » ; sinon le style suit le nom de famille (« MontserratSemiBold »).
  const style = (sep >= 0 ? name.slice(sep + 1) : name.slice(parseFontName(name).base.length)).toLowerCase();
  const weight = WEIGHTS.find(([re]) => re.test(style))?.[1] ?? (hints.bold ? 700 : 400);
  return { weight, italic: /italic|oblique/.test(style) || !!hints.italic };
}

interface DocFont {
  family: string;
  weight: number;
  italic: boolean;
  url: string;
}

/** Clé de registre : contient tout le nécessaire pour réenregistrer la police à la reprise d'un travail. */
const keyOf = (f: DocFont) => `doc:${f.family}|${f.weight}|${f.italic ? 1 : 0}|${f.url}`;

function register(f: DocFont): string {
  const key = keyOf(f);
  const weightLabel: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
  registerFontEntry({
    key,
    label: `${f.family} ${weightLabel[f.weight] ?? f.weight}${f.italic ? " Italique" : ""} (police du document)`.replace(/\s+/g, " "),
    source: "library",
    category: "etat", // groupe « Police du document » du sélecteur
    cssFamily: `"fl-doc-${f.family.replace(/[^a-zA-Z0-9]/g, "")}-${f.weight}-${f.italic ? "i" : "n"}"`,
    family: f.family,
    bold: f.weight >= 600,
    italic: f.italic,
    load: async () => {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`Police ${f.family} indisponible (connexion internet nécessaire au premier usage).`);
      return res.arrayBuffer();
    },
  });
  return key;
}

/** DejaVu : les noms PDF sont les noms des fichiers (DejaVuSans-Bold, DejaVuSerif-Italic…). */
function dejavu(pdfFontName: string): DocFont | null {
  const name = pdfFontName.replace(/^[A-Z]{6}\+/, "");
  const m = /^(DejaVu(?:Sans|Serif)(?:Mono|Condensed)?)(?:-(Bold|Oblique|BoldOblique|Italic|BoldItalic|ExtraLight))?$/.exec(name);
  if (!m) return null;
  const { weight, italic } = fontWeight(name);
  const family = "DejaVu " + m[1].slice("DejaVu".length).replace(/([a-z])([A-Z])/g, "$1 $2");
  return { family, weight, italic, url: `${DEJAVU_URL}${name}.ttf` };
}

/** Police libre connue du catalogue, à une graisse intermédiaire : fichier Fontsource de cette graisse. */
function openFontWeight(pdfFontName: string, hints: { bold?: boolean; italic?: boolean }, fonts: FontEntry[]): DocFont | null {
  const { weight, italic } = fontWeight(pdfFontName, hints);
  if (weight === 400 || weight === 700) return null; // la bibliothèque a déjà ces graisses complètes
  const base = parseFontName(pdfFontName).base;
  const entry = fonts.find(
    (f) => f.source === "library" && (f.category === "google" || f.slug) && f.family && normalizeFontName(f.family) === base,
  );
  if (!entry?.family) return null;
  const id = entry.family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { family: entry.family, weight, italic, url: `${FONTSOURCE_URL}${id}@latest/latin-${weight}-${italic ? "italic" : "normal"}.ttf` };
}

/**
 * Clé de la police complète du document pour un texte du PDF, ou null s'il n'y
 * en a pas de source autorisée (l'appelant prend alors la police la plus proche).
 */
export function documentFontFor(
  pdfFontName: string | undefined,
  hints: { bold?: boolean; italic?: boolean } = {},
  fonts: FontEntry[] = getFonts(),
): string | null {
  if (!pdfFontName) return null;
  const state = stateFontFor(pdfFontName, hints);
  if (state) return state;
  const f = dejavu(pdfFontName) ?? openFontWeight(pdfFontName, hints, fonts);
  return f ? register(f) : null;
}

/** À la reprise d'un travail : réenregistre les polices de document utilisées. */
export function restoreDocumentFont(key: string): void {
  if (key.startsWith("etat:")) return restoreStateFont(key);
  const m = /^doc:([^|]+)\|(\d+)\|([01])\|(.+)$/.exec(key);
  if (m) register({ family: m[1], weight: +m[2], italic: m[3] === "1", url: m[4] });
}
