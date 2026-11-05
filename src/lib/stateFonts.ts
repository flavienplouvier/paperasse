import { registerFontEntry } from "./fonts";
import { t } from "../i18n";

/**
 * Police Marianne (marque de l'État) pour retoucher les documents de l'État
 * qui l'utilisent déjà (Cerfa…).
 *
 * L'usage de Marianne est réservé à l'administration (circulaire n° 6144/SG) :
 * Paperasse ne la redistribue pas. Elle est chargée à la demande depuis le
 * serveur officiel, et seulement quand le PDF ouvert est déjà composé en
 * Marianne, pour que les lettres absentes de la police incorporée au document
 * (ex. un « P ») soient les vraies.
 */

export const STATE_FONT_SERVER = "https://fonts.forge.apps.education.fr/marianne/";

const WEIGHTS: [RegExp, string, number][] = [
  [/extra-?bold|ultra-?bold|heavy|black/, "ExtraBold", 800],
  [/semi-?bold|demi-?bold|medium/, "Medium", 500],
  [/bold/, "Bold", 700],
  [/thin|extra-?light|ultra-?light|hairline/, "Thin", 100],
  [/light/, "Light", 300],
];

/** Variante de Marianne d'un nom de police PDF (« ABCDEF+Marianne-ExtraBold » → « Marianne-ExtraBold »), sinon null. */
export function marianneVariant(pdfFontName: string | undefined, hints: { bold?: boolean; italic?: boolean } = {}): string | null {
  if (!pdfFontName) return null;
  const name = pdfFontName.replace(/^[A-Z]{6}\+/, "").toLowerCase();
  if (!/^marianne(\b|[-_, ]|$)/.test(name)) return null;
  const style = name.slice("marianne".length);
  const weight = WEIGHTS.find(([re]) => re.test(style))?.[1] ?? (hints.bold ? "Bold" : "Regular");
  const italic = /italic|oblique/.test(style) || !!hints.italic;
  return `Marianne-${weight}${italic ? "_Italic" : ""}`;
}

/** Clé de police d'une variante (enregistrée à la demande, téléchargée au premier usage). */
export function stateFontKey(variant: string): string {
  const key = `etat:${variant}`;
  const [, weight, italic] = /^Marianne-(\w+?)(_Italic)?$/.exec(variant) ?? [];
  registerFontEntry({
    key,
    get label() {
      return t("{font} (police de l'État)", { font: `Marianne ${weight}${italic ? " " + t("Italique") : ""}` });
    },
    source: "library",
    category: "etat",
    cssFamily: `"fl-etat-${variant}"`,
    family: "Marianne",
    bold: (WEIGHTS.find(([, w]) => w === weight)?.[2] ?? 400) >= 700,
    italic: !!italic,
    load: async () => {
      // WOFF2 : les fichiers WOFF de ce serveur (contours CFF) ne sont pas lus correctement par fontkit.
      const res = await fetch(`${STATE_FONT_SERVER}${variant}.woff2`);
      if (!res.ok) throw new Error(t("Police {font} indisponible (connexion internet nécessaire au premier usage).", { font: "Marianne" }));
      return res.arrayBuffer();
    },
  });
  return key;
}

/** Clé de la vraie Marianne pour un texte du PDF composé en Marianne, sinon null. */
export function stateFontFor(pdfFontName: string | undefined, hints?: { bold?: boolean; italic?: boolean }): string | null {
  const variant = marianneVariant(pdfFontName, hints);
  return variant ? stateFontKey(variant) : null;
}

/** À la reprise d'un travail : réenregistre les polices de l'État utilisées. */
export function restoreStateFont(key: string): void {
  if (key.startsWith("etat:")) stateFontKey(key.slice("etat:".length));
}
