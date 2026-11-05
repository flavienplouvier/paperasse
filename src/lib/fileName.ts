/**
 * Nom du fichier à l'enregistrement : nom choisi, date facultative (format et
 * position au choix), espaces remplacés ou non par des « _ ».
 */

export type DateFormat = "iso" | "fr";
export type DatePosition = "end" | "start";

export interface NameOptions {
  base: string;
  /** Date au format AAAA-MM-JJ (valeur d'un champ date), ou null sans date. */
  date: string | null;
  format: DateFormat;
  position: DatePosition;
  underscores: boolean;
}

/** Préférences retenues d'un enregistrement à l'autre. */
export type NamePrefs = Pick<NameOptions, "format" | "position" | "underscores">;

export const DEFAULT_PREFS: NamePrefs = { format: "iso", position: "end", underscores: true };

/** Date du jour au format AAAA-MM-JJ (heure locale). */
export function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 2026-11-05 → « 2026-11-05 » (iso) ou « 05-11-2026 » (fr). */
export function formatDate(iso: string, format: DateFormat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return format === "fr" ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/** Nom débarrassé de l'extension et des caractères interdits par les systèmes de fichiers. */
export function cleanBase(base: string): string {
  return base
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
}

/** « Facture EDF » + 2026-11-05 → « Facture_EDF_2026-11-05.pdf » (selon les options). */
export function buildFileName(o: NameOptions): string {
  let name = cleanBase(o.base) || "Document";
  const sep = o.underscores ? "_" : " ";
  if (o.underscores) name = name.replace(/ /g, "_");
  if (o.date) {
    const d = formatDate(o.date, o.format);
    name = o.position === "start" ? `${d}${sep}${name}` : `${name}${sep}${d}`;
  }
  return `${name}.pdf`;
}

const KEY = "paperasse-nom-fichier";

export function loadNamePrefs(): NamePrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveNamePrefs(prefs: NamePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* navigation privée */
  }
}
