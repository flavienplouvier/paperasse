import { useSyncExternalStore } from "react";

/**
 * Traduction de l'interface. Les phrases sont écrites en français dans le code
 * (`t("Ouvrir un fichier")`) ; chaque autre langue est un fichier JSON
 * `src/locales/<code>.json` (« phrase française » → traduction), chargé
 * seulement quand on la choisit, puis gardé hors ligne par le service worker.
 *
 * - Variables : `t("Page {n} / {total}", { n, total })`.
 * - Pluriels : `tn("{n} page", "{n} pages", n)`.
 * - Libellés définis hors des composants : `msg("…")` les marque pour
 *   l'extraction, `t(libellé)` les traduit à l'affichage.
 *
 * `npm run i18n` met à jour la liste des phrases (src/locales/fr.json) et
 * signale les traductions manquantes.
 */

export type Locale = "fr" | "en" | "de" | "es" | "it" | "pt" | "nl" | "zh";
export const LOCALES: Locale[] = ["fr", "en", "de", "es", "it", "pt", "nl", "zh"];

type Catalog = Record<string, string>;
type Vars = Record<string, string | number>;

let locale: Locale = "fr";
let catalog: Catalog = {};
const listeners = new Set<() => void>();

const loaders = import.meta.glob<Catalog>(["./locales/*.json", "!./locales/fr.json"], { import: "default" });

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Traduit une phrase française dans la langue de l'interface. */
export function t(source: string, vars?: Vars): string {
  return fill((locale !== "fr" && catalog[source]) || source, vars);
}

/** Pluriel : `n` est aussi disponible comme variable {n}. */
export function tn(one: string, other: string, n: number, vars?: Vars): string {
  const form = new Intl.PluralRules(locale).select(n) === "one" ? one : other;
  return t(form, { n: n.toLocaleString(locale), ...vars });
}

/** Marque un libellé à traduire plus tard (à l'affichage, avec t). */
export const msg = (source: string) => source;

export function currentLocale(): Locale {
  return locale;
}

/** Charge la langue (téléchargée une fois) puis rafraîchit l'interface. */
export async function setLocale(next: Locale): Promise<void> {
  if (next !== "fr") {
    const load = loaders[`./locales/${next}.json`];
    catalog = load ? await load() : {};
  } else catalog = {};
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** À appeler dans un composant qui affiche du texte : il se redessine au changement de langue. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale, currentLocale);
}

/** Pour les tests : charge un catalogue directement. */
export function setCatalogForTests(next: Locale, entries: Catalog) {
  locale = next;
  catalog = entries;
}
