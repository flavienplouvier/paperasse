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

export interface FoundDate {
  /** Date trouvée, au format AAAA-MM-JJ. */
  date: string;
  format: DateFormat;
  position: DatePosition;
  /** Séparateur entre la date et le nom : « _ » ou espace (null pour « - » ou rien). */
  underscores: boolean | null;
  /** Nom sans la date. */
  rest: string;
}

const ISO = "(\\d{4})[-_.](\\d{2})[-_.](\\d{2})";
const FR = "(\\d{2})[-_.](\\d{2})[-_.](\\d{4})";

function validDate(y: string, m: string, d: string): string | null {
  const mm = +m, dd = +d, yy = +y;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 1900 || yy > 2199) return null;
  return `${y}-${m}-${d}`;
}

/**
 * Date en tête ou en fin de nom (« Facture_EDF_2026-11-05 », « 05-11-2026 Facture ») :
 * renvoie la date, son format, sa position et le nom sans elle.
 */
export function findDate(name: string): FoundDate | null {
  const stem = name.replace(/\.pdf$/i, "").trim();
  for (const [format, pattern] of [
    ["iso", ISO],
    ["fr", FR],
  ] as const) {
    const end = new RegExp(`^(.*?)([ _-]*)${pattern}$`).exec(stem);
    const start = new RegExp(`^${pattern}([ _-]*)(.*)$`).exec(stem);
    for (const [m, position] of [
      [end, "end"],
      [start, "start"],
    ] as const) {
      if (!m) continue;
      const [rest, sep, a, b, c] = position === "end" ? [m[1], m[2], m[3], m[4], m[5]] : [m[5], m[4], m[1], m[2], m[3]];
      // Une date collée à du texte (« ref20261105 ») n'en est probablement pas une.
      if (rest && !sep) continue;
      const date = format === "iso" ? validDate(a, b, c) : validDate(c, b, a);
      if (!date) continue;
      const s = sep.trim() ? sep.trim()[0] : sep ? " " : "";
      return { date, format, position: rest ? position : "end", underscores: s === "_" ? true : s === " " ? false : null, rest: rest.trim() };
    }
  }
  return null;
}
