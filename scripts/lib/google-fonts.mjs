// Construction de l'index du catalogue libre Google Fonts à partir de la liste
// des fichiers du dépôt github.com/google/fonts (dossiers ofl/ et apache/ :
// licences SIL Open Font License et Apache 2.0 uniquement).

const STYLE = { Regular: "regular", Bold: "bold", Italic: "italic", BoldItalic: "boldItalic" };
const SKIP = /emoji|materialicons|materialsymbols|icons$|symbols\d*$/i;

/** « IBMPlexSans » → « IBM Plex Sans », « OpenSans » → « Open Sans ». */
export function displayName(stem) {
  return stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .trim();
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * @param {string[]} paths chemins des fichiers du dépôt
 * @param {Iterable<string>} bundled familles déjà fournies hors ligne (à ignorer)
 * @returns {{ id: string, family: string, license: "ofl" | "apache", variable: boolean,
 *   styles: Partial<Record<"regular"|"bold"|"italic"|"boldItalic", string>> }[]}
 */
export function buildCatalog(paths, bundled = []) {
  const skip = new Set([...bundled].map(norm));
  const groups = new Map();
  for (const path of paths) {
    const m = /^(ofl|apache)\/([^/]+)\/(static\/)?([^/]+\.ttf)$/.exec(path);
    if (!m) continue;
    const [, license, dir, inStatic, file] = m;
    const key = `${license}/${dir}`;
    if (!groups.has(key)) groups.set(key, { license, dir, files: [] });
    groups.get(key).files.push({ rel: `${inStatic ?? ""}${file}`, file, inStatic: !!inStatic });
  }

  const catalog = [];
  for (const { license, dir, files } of groups.values()) {
    if (skip.has(norm(dir)) || SKIP.test(dir)) continue;
    const styles = {};
    let stem = "";
    let variable = false;
    // Fichiers statiques d'abord (vraies graisses), à la racine de préférence.
    for (const f of [...files].sort((a, b) => Number(a.inStatic) - Number(b.inStatic))) {
      const s = /^(.+?)-(Regular|Bold|Italic|BoldItalic)\.ttf$/.exec(f.file);
      if (s && !styles[STYLE[s[2]]]) {
        styles[STYLE[s[2]]] = f.rel;
        stem ||= s[1];
      }
    }
    // Polices variables : style par défaut (et italique) si pas de fichier statique.
    for (const f of files) {
      const v = /^(.+?)(-Italic)?\[[^\]]+\]\.ttf$/.exec(f.file);
      if (!v) continue;
      const style = v[2] ? "italic" : "regular";
      if (!styles[style]) {
        styles[style] = f.rel;
        variable = true;
      }
      stem ||= v[1];
    }
    // Familles sans « Regular » (ex. une seule graisse « Light ») : premier fichier.
    if (!styles.regular && !styles.italic) {
      const first = files.find((f) => !f.inStatic) ?? files[0];
      styles.regular = first.rel;
      stem ||= first.file.replace(/-[^-]*\.ttf$|\.ttf$/, "");
    }
    catalog.push({ id: dir, family: displayName(stem || dir), license, variable, styles });
  }
  return catalog.sort((a, b) => a.family.localeCompare(b.family));
}
