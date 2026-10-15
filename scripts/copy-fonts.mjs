// Prépare la bibliothèque de polices libres (OFL / Apache) servie par
// l'application : pour chaque famille @expo-google-fonts/* listée dans
// package.json, copie les styles normal, gras, italique et gras italique
// (ou les graisses les plus proches) dans public/fonts/<famille>/, avec la
// licence, et écrit public/fonts/catalog.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const target = join("public", "fonts");

// Catégorie de chaque famille (pour le classement dans le sélecteur).
const CATEGORY = {
  metric: ["carlito", "caladea", "arimo", "tinos", "cousine", "gelasio"],
  serif: [
    "noto-serif", "merriweather", "playfair-display", "pt-serif", "roboto-slab", "lora", "eb-garamond",
    "libre-baskerville", "crimson-text", "source-serif-4", "bitter", "cormorant-garamond", "spectral",
    "ibm-plex-serif", "domine", "zilla-slab",
  ],
  mono: ["roboto-mono", "source-code-pro", "fira-code", "ibm-plex-mono", "jetbrains-mono", "space-mono", "inconsolata"],
  script: [
    "dancing-script", "great-vibes", "pacifico", "caveat", "sacramento", "allura", "satisfy", "kalam",
    "indie-flower", "shadows-into-light", "permanent-marker",
  ],
  display: ["lobster", "bebas-neue", "abril-fatface", "alfa-slab-one"],
};
const categoryOf = (slug) => Object.keys(CATEGORY).find((c) => CATEGORY[c].includes(slug)) ?? "sans";

const UPPER = new Set(["pt", "ibm", "eb", "dm"]);
const displayName = (slug) =>
  slug
    .split("-")
    .map((w) => (UPPER.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

// Dossiers du paquet : « 400Regular », « 700Bold_Italic »…
function variants(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const m = /^(\d{3})[A-Za-z]+(_Italic)?$/.exec(d.name);
      if (!m) return null;
      const file = readdirSync(join(dir, d.name)).find((f) => f.endsWith(".ttf"));
      return file ? { weight: Number(m[1]), italic: Boolean(m[2]), path: join(dir, d.name, file), file } : null;
    })
    .filter(Boolean);
}

function pick(list, weight, italic) {
  const same = list.filter((v) => v.italic === italic);
  if (!same.length) return null;
  return same.reduce((best, v) => (Math.abs(v.weight - weight) < Math.abs(best.weight - weight) ? v : best));
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const catalog = [];
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith("@expo-google-fonts/"));
for (const dep of deps.sort()) {
  const slug = dep.split("/")[1];
  if (slug === "dev") continue;
  const root = dirname(require.resolve(`${dep}/package.json`));
  const list = variants(root);
  if (!list.length) continue;
  mkdirSync(join(target, slug), { recursive: true });
  const styles = {};
  for (const [key, weight, italic] of [
    ["regular", 400, false],
    ["bold", 700, false],
    ["italic", 400, true],
    ["boldItalic", 700, true],
  ]) {
    const v = pick(list, weight, italic);
    // On ne réutilise pas le même fichier pour « gras » si la famille n'a qu'une graisse.
    if (!v || (key === "bold" && v.weight < 600) || (key === "boldItalic" && v.weight < 600)) continue;
    if (Object.values(styles).includes(v.file)) continue;
    copyFileSync(v.path, join(target, slug, v.file));
    styles[key] = v.file;
  }
  for (const lic of ["LICENSE_FONT", "OFL.txt", "LICENSE"]) {
    if (existsSync(join(root, lic))) {
      copyFileSync(join(root, lic), join(target, slug, "LICENSE.txt"));
      break;
    }
  }
  catalog.push({ slug, family: displayName(slug), category: categoryOf(slug), styles });
}

writeFileSync(join(target, "catalog.json"), JSON.stringify(catalog));
console.log(`Bibliothèque de polices : ${catalog.length} familles copiées dans ${target}`);
