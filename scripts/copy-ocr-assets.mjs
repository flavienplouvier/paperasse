// Copie le moteur de reconnaissance de texte (tesseract.js, Apache-2.0) et
// les données des langues (français, anglais) dans public/ocr/ : l'OCR
// fonctionne ainsi sans aucun service externe, et hors ligne une fois chargé.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = (pkg) => dirname(require.resolve(`${pkg}/package.json`));
const target = join("public", "ocr");

rmSync(target, { recursive: true, force: true });
for (const dir of ["", "core", "lang"]) mkdirSync(join(target, dir), { recursive: true });

copyFileSync(join(root("tesseract.js"), "dist", "worker.min.js"), join(target, "worker.min.js"));

// Cœur WebAssembly de la version attendue par tesseract.js (résolu depuis
// tesseract.js lui-même). Moteur LSTM uniquement (mode par défaut), dans les
// trois variantes que tesseract.js choisit selon le processeur.
const core = dirname(createRequire(join(root("tesseract.js"), "package.json")).resolve("tesseract.js-core/package.json"));
for (const file of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  if (existsSync(join(core, file))) copyFileSync(join(core, file), join(target, "core", file));
}

// Modèles compacts « best_int » : bonne précision pour une taille réduite.
for (const lang of ["fra", "eng"]) {
  const file = join(root(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`);
  if (existsSync(file)) copyFileSync(file, join(target, "lang", `${lang}.traineddata.gz`));
}

console.log(`Moteur OCR copié dans ${target}`);
