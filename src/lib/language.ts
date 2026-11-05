/**
 * Langue de l'utilisateur, détectée au démarrage depuis le navigateur. Elle
 * règle la langue proposée par défaut pour la reconnaissance de texte (OCR).
 */

export type FlagId = "fr" | "gb" | "us" | "de" | "es" | "it" | "pt" | "nl" | "cn";

export interface Language {
  /** Code Tesseract (fra, eng…). */
  ocr: string;
  /** Code de langue du navigateur (fr, en…). */
  code: string;
  /** Nom en français (OCR). */
  label: string;
  /** Nom dans la langue elle-même, pour que chacun reconnaisse la sienne. */
  native: string;
  /** Données OCR fournies avec l'application ; les autres sont téléchargées une fois au premier usage. */
  bundled: boolean;
}

export const LANGUAGES: Language[] = [
  { ocr: "fra", code: "fr", native: "Français", label: "Français", bundled: true },
  { ocr: "eng", code: "en", native: "English", label: "Anglais", bundled: true },
  { ocr: "deu", code: "de", native: "Deutsch", label: "Allemand", bundled: false },
  { ocr: "spa", code: "es", native: "Español", label: "Espagnol", bundled: false },
  { ocr: "ita", code: "it", native: "Italiano", label: "Italien", bundled: false },
  { ocr: "por", code: "pt", native: "Português", label: "Portugais", bundled: false },
  { ocr: "nld", code: "nl", native: "Nederlands", label: "Néerlandais", bundled: false },
  { ocr: "chi_sim", code: "zh", native: "中文", label: "Chinois", bundled: false },
];

export interface UserLanguage {
  language: Language;
  /** Drapeau affiché (l'anglais américain a le sien). */
  flag: FlagId;
}

const FLAGS: Record<string, FlagId> = { fr: "fr", en: "gb", de: "de", es: "es", it: "it", pt: "pt", nl: "nl", zh: "cn" };

/** Drapeau d'une langue (l'anglais selon la région du navigateur). */
export function flagFor(language: Language, region?: string): FlagId {
  return language.code === "en" && region === "US" ? "us" : FLAGS[language.code];
}

export function languageByOcr(ocr: string): Language {
  return LANGUAGES.find((l) => l.ocr === ocr) ?? LANGUAGES[0];
}

function userLanguage(language: Language, region?: string): UserLanguage {
  return { language, flag: flagFor(language, region) };
}

/** Première langue prise en charge parmi celles du navigateur (« de-CH » → allemand). */
export function detectLanguage(preferred: readonly string[]): UserLanguage {
  for (const tag of preferred) {
    const [code, region] = tag.split(/[-_]/);
    const language = LANGUAGES.find((l) => l.code === code.toLowerCase());
    if (language) return userLanguage(language, region?.toUpperCase());
  }
  return userLanguage(LANGUAGES[0]);
}

const KEY = "paperasse-langue";

/** Langue choisie par l'utilisateur, sinon celle du navigateur. */
export function initialLanguage(): UserLanguage {
  const browser = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language ?? "fr"];
  const detected = detectLanguage(browser);
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved !== detected.language.ocr) {
      const l = LANGUAGES.find((x) => x.ocr === saved);
      if (l) return userLanguage(l, saved === "eng" ? browser.find((t) => t.startsWith("en"))?.split(/[-_]/)[1]?.toUpperCase() : undefined);
    }
  } catch {
    /* stockage indisponible */
  }
  return detected;
}

export function chooseLanguage(ocr: string): UserLanguage {
  try {
    localStorage.setItem(KEY, ocr);
  } catch {
    /* navigation privée */
  }
  const browser = typeof navigator === "undefined" ? [] : navigator.languages ?? [];
  const region = browser.find((t) => t.startsWith(languageByOcr(ocr).code))?.split(/[-_]/)[1]?.toUpperCase();
  return userLanguage(languageByOcr(ocr), region);
}

/** Choix de langues proposés pour l'OCR, la langue de l'utilisateur en premier. */
export function ocrChoices(first: Language): { value: string; label: string }[] {
  const list = [first, ...LANGUAGES.filter((l) => l !== first)].map((l) => ({ value: l.ocr, label: l.label }));
  // Mélange français-anglais, fréquent dans les documents administratifs et techniques.
  list.splice(first.ocr === "fra" || first.ocr === "eng" ? 1 : list.length, 0, { value: "fra+eng", label: "Français et anglais" });
  return list;
}
