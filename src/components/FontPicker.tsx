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
    return {
      standard: list.filter((x) => x.source === "standard"),
      file: list.filter((x) => x.source === "file"),
      local: list.filter((x) => x.source === "local").slice(0, 400),
    };
  }, [fonts, filter]);

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
      {fonts.length > 20 && (
        <input type="search" placeholder="Filtrer les polices…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      <select value={value} onChange={(e) => pick(e.target.value)}>
        <optgroup label="Polices standard PDF">
          {groups.standard.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </optgroup>
        {groups.file.length > 0 && (
          <optgroup label="Polices importées">
            {groups.file.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        )}
        {groups.local.length > 0 && (
          <optgroup label="Polices de l'ordinateur">
            {groups.local.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        )}
        {!fonts.some((f) => f.key === value) && <option value={value}>{getFont(value).label}</option>}
      </select>
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
