// Extrait les phrases à traduire (t("…"), tn("…", "…", n), msg("…")) de src/
// vers src/locales/fr.json, puis signale pour chaque langue les traductions
// manquantes ou devenues inutiles. `--check` échoue s'il en manque.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STR = '"((?:[^"\\\\\\n]|\\\\.)*)"';
const patterns = [new RegExp(`\\b(?:t|msg)\\(\\s*${STR}`, "g"), new RegExp(`\\btn\\(\\s*${STR}\\s*,\\s*${STR}`, "g")];

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "locales" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "i18n.ts" ? [p] : [];
  });
}

export function extract(root = "src") {
  const keys = new Set();
  for (const file of files(root)) {
    const src = readFileSync(file, "utf8");
    for (const re of patterns) {
      for (const m of src.matchAll(re)) for (const s of m.slice(1)) if (s !== undefined) keys.add(JSON.parse(`"${s}"`));
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, "fr"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = extract();
  mkdirSync("src/locales", { recursive: true });
  writeFileSync("src/locales/fr.json", JSON.stringify(Object.fromEntries(keys.map((k) => [k, k])), null, 2) + "\n");
  console.log(`${keys.length} phrases dans src/locales/fr.json`);
  let missingTotal = 0;
  for (const f of readdirSync("src/locales").filter((f) => f.endsWith(".json") && f !== "fr.json")) {
    const cat = JSON.parse(readFileSync(join("src/locales", f), "utf8"));
    const missing = keys.filter((k) => !cat[k]);
    const unused = Object.keys(cat).filter((k) => !keys.includes(k));
    missingTotal += missing.length;
    console.log(`${f} : ${missing.length} manquante(s), ${unused.length} inutile(s)`);
    if (process.argv.includes("--verbose")) missing.forEach((k) => console.log("  - " + k));
  }
  if (process.argv.includes("--check") && missingTotal) process.exit(1);
}
