// Copie les ressources de pdf.js nécessaires au rendu de toutes les polices :
// CMaps (écritures CJK et encodages prédéfinis), polices standard (les 14 polices
// de base non intégrées), décodeurs WASM (JPEG 2000, JBIG2…) et profils ICC.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(process.cwd(), "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const source = join(pdfjsRoot, folder);
  if (existsSync(source)) {
    cpSync(source, join(target, folder), { recursive: true });
  }
}

console.log(`Ressources pdf.js copiées dans ${target}`);
