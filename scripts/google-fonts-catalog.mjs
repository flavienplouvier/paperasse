// Génère public/google-fonts.json : index du catalogue libre Google Fonts
// (≈ 1 700 familles), figé sur une version précise du dépôt google/fonts.
// Les fichiers TTF sont téléchargés par l'application à la demande.
// Usage : npm run fonts:catalog  (à relancer pour suivre les nouveautés)
import { readFileSync, writeFileSync } from "node:fs";
import { buildCatalog } from "./lib/google-fonts.mjs";

const headers = { "User-Agent": "paperasse-catalog", Accept: "application/vnd.github+json" };
const get = async (url) => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} : ${res.status} ${res.statusText}`);
  return res.json();
};

const branch = await get("https://api.github.com/repos/google/fonts/branches/main");
const sha = branch.commit.sha;
const tree = await get(`https://api.github.com/repos/google/fonts/git/trees/${sha}?recursive=1`);
if (tree.truncated) throw new Error("Liste des fichiers tronquée par GitHub.");

// Familles déjà fournies hors ligne avec l'application (paquets @expo-google-fonts).
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const bundled = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter((d) => d.startsWith("@expo-google-fonts/"))
  .map((d) => d.split("/")[1]);

const families = buildCatalog(
  tree.tree.map((t) => t.path),
  bundled,
);
// Format compact : [id, nom, licence, variable, regular, bold, italic, boldItalic]
const rows = families.map((f) => [
  f.id,
  f.family,
  f.license,
  f.variable ? 1 : 0,
  f.styles.regular ?? "",
  f.styles.bold ?? "",
  f.styles.italic ?? "",
  f.styles.boldItalic ?? "",
]);
writeFileSync("public/google-fonts.json", JSON.stringify({ sha, generated: new Date().toISOString().slice(0, 10), rows }));
console.log(`Catalogue Google Fonts : ${rows.length} familles (commit ${sha.slice(0, 7)})`);
