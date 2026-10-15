import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addFontFiles,
  ensureCssFont,
  getFont,
  getFonts,
  loadLocalFonts,
  localFontsSupported,
  subscribeFonts,
} from "../lib/fonts";

export function useFonts() {
  return useSyncExternalStore(subscribeFonts, getFonts, getFonts);
}

/** Choix de police : standard, installées sur l'ordinateur ou importées. */
export function FontPicker({ value, onChange, onError }: { value: string; onChange: (key: string) => void; onError: (msg: string) => void }) {
  const fonts = useFonts();
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? fonts.filter((x) => x.label.toLowerCase().includes(f)) : fonts;
    const lib = (cat: string) => list.filter((x) => x.source === "library" && x.category === cat);
    return [
      { label: "Polices importées", items: list.filter((x) => x.source === "file") },
      { label: "Équivalents Office / Windows (mêmes largeurs)", items: lib("metric") },
      { label: "Polices standard PDF", items: list.filter((x) => x.source === "standard") },
      { label: "Sans empattement", items: lib("sans") },
      { label: "Avec empattement", items: lib("serif") },
      { label: "Chasse fixe", items: lib("mono") },
      { label: "Manuscrites / signature", items: lib("script") },
      { label: "Décoratives", items: lib("display") },
      { label: "Polices de l'ordinateur", items: list.filter((x) => x.source === "local").slice(0, 600) },
    ].filter((g) => g.items.length);
  }, [fonts, filter]);
  const current = getFont(value);

  const pick = async (key: string) => {
    try {
      await ensureCssFont(key);
    } catch {
      onError(`Impossible de charger la police ${getFont(key).label} pour l'aperçu.`);
    }
    onChange(key);
  };

  const hasLocal = fonts.some((f) => f.source === "local");

  return (
    <div className="font-picker">
      <input
        type="search"
        placeholder={`Rechercher parmi ${fonts.length} polices…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <select value={value} onChange={(e) => pick(e.target.value)}>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
        {!groups.some((g) => g.items.some((f) => f.key === value)) && <option value={value}>{current.label}</option>}
      </select>
      <div className="font-sample" style={{ fontFamily: current.cssFamily }}>
        Portez ce vieux whisky au juge blond — 0123
      </div>
      <div className="font-actions">
        {localFontsSupported() && !hasLocal && (
          <button
            onClick={() =>
              loadLocalFonts()
                .then((n) => n === 0 && onError("Aucune police trouvée ou accès refusé."))
                .catch((e: Error) => onError(e.message))
            }
          >
            Utiliser mes polices installées
          </button>
        )}
        <button onClick={() => fileRef.current?.click()}>Importer TTF/OTF…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.ttc,.otc,font/ttf,font/otf,font/collection"
          multiple
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            try {
              const keys = await addFontFiles(Array.from(files));
              if (keys[0]) onChange(keys[0]);
            } catch {
              onError("Ce fichier de police n'a pas pu être lu (formats acceptés : TTF, OTF).");
            }
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
