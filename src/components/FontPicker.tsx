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

/** Choix de police : bibliothèque, catalogue libre, standard, installées ou importées. */
export function FontPicker({
  value,
  onChange,
  onError,
  onLocalFonts,
}: {
  value: string;
  onChange: (key: string) => void;
  onError: (msg: string) => void;
  /** Appelé quand les polices de l'ordinateur viennent d'être chargées. */
  onLocalFonts?: () => void;
}) {
  const fonts = useFonts();
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<string | null>(null);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? fonts.filter((x) => x.label.toLowerCase().includes(f)) : fonts;
    const lib = (cat: string) => list.filter((x) => x.source === "library" && x.category === cat);
    return [
      { label: "Polices importées", items: list.filter((x) => x.source === "file") },
      { label: "Polices de l'ordinateur", items: list.filter((x) => x.source === "local").slice(0, 800) },
      { label: "Équivalents Office / Windows (mêmes largeurs)", items: lib("metric") },
      { label: "Polices standard PDF", items: list.filter((x) => x.source === "standard") },
      { label: "Sans empattement", items: lib("sans") },
      { label: "Avec empattement", items: lib("serif") },
      { label: "Chasse fixe", items: lib("mono") },
      { label: "Manuscrites / signature", items: lib("script") },
      { label: "Décoratives", items: lib("display") },
      // Catalogue libre complet : affiché pendant une recherche (≈ 2 000 familles).
      { label: "Catalogue libre Google Fonts", items: f.length >= 2 ? lib("google").slice(0, 400) : [] },
    ].filter((g) => g.items.length);
  }, [fonts, filter]);
  const families = useMemo(() => new Set(fonts.map((f) => f.family ?? f.label)).size, [fonts]);
  const current = getFont(value);

  const useLocalFonts = async () => {
    setStatus("Autorisez l'accès aux polices dans la fenêtre du navigateur…");
    try {
      const added = await loadLocalFonts();
      const total = getFonts().filter((f) => f.source === "local").length;
      setStatus(
        total
          ? `✓ ${total} polices de l'ordinateur disponibles${added ? "" : " (déjà chargées)"} — en tête de la liste.`
          : null,
      );
      if (!total) onError("Aucune police trouvée : l'accès a peut-être été refusé dans le navigateur.");
      onLocalFonts?.();
    } catch (e) {
      setStatus(null);
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      onError(
        denied
          ? "Accès aux polices refusé. Autorisez-le via l'icône à gauche de l'adresse (Paramètres du site → Polices), puis réessayez."
          : e instanceof Error
            ? e.message
            : "Impossible de lire les polices de l'ordinateur.",
      );
    }
  };

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
        placeholder={`Rechercher parmi ${families} familles de polices…`}
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
        {localFontsSupported() ? (
          <button onClick={useLocalFonts}>{hasLocal ? "Recharger mes polices installées" : "Utiliser mes polices installées"}</button>
        ) : (
          <span className="hint">
            Polices de l'appareil : non accessibles dans ce navigateur (uniquement Chrome / Edge sur ordinateur). Importez un
            fichier de police à la place.
          </span>
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
      {status && <p className="font-status ok">{status}</p>}
    </div>
  );
}
