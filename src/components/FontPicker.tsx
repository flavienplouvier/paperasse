import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addFontFiles,
  ensureCssFont,
  type FontEntry,
  getFont,
  getFonts,
  loadLocalFonts,
  localFontsSupported,
  subscribeFonts,
} from "../lib/fonts";

export function useFonts() {
  return useSyncExternalStore(subscribeFonts, getFonts, getFonts);
}

/**
 * Style CSS pour afficher le nom d'une police dans cette police. Les polices de
 * l'ordinateur et standard s'affichent directement ; les autres une fois chargées.
 */
function previewStyle(f: FontEntry): CSSProperties {
  if (f.source === "local" && f.family) {
    return { fontFamily: `"${f.family}"`, fontWeight: f.bold ? 700 : 400, fontStyle: f.italic ? "italic" : "normal" };
  }
  const synthetic = f.source === "standard";
  return {
    fontFamily: `${f.cssFamily}, system-ui, sans-serif`,
    fontWeight: synthetic && f.bold ? 700 : undefined,
    fontStyle: synthetic && f.italic ? "italic" : undefined,
  };
}

/** Ligne de la liste : charge la police seulement quand elle devient visible. */
function FontOption({
  font,
  selected,
  root,
  onPick,
}: {
  font: FontEntry;
  selected: boolean;
  root: RefObject<HTMLDivElement | null>;
  onPick: (key: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (font.source === "standard" || font.source === "local") return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          ensureCssFont(font.key).catch(() => undefined);
        }
      },
      { root: root.current, rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [font, root]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      className={`font-option ${selected ? "selected" : ""}`}
      style={previewStyle(font)}
      onClick={() => onPick(font.key)}
    >
      {font.label}
    </button>
  );
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
  const listRef = useRef<HTMLDivElement>(null);

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
      <div className="font-current" style={previewStyle(current)} title="Police actuelle">
        {current.label}
      </div>
      <div className="font-list" role="listbox" aria-label="Polices" ref={listRef}>
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label}>
            <div className="font-group">{g.label}</div>
            {g.items.map((f) => (
              <FontOption key={f.key} font={f} selected={f.key === value} root={listRef} onPick={pick} />
            ))}
          </div>
        ))}
        {!groups.length && <p className="hint pad">Aucune police ne correspond à « {filter} ».</p>}
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
        <button onClick={() => fileRef.current?.click()} title="Formats acceptés : TTF, OTF, TTC, WOFF, WOFF2">
          Importer une police…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.ttc,.otc,.woff,.woff2,font/ttf,font/otf,font/collection,font/woff,font/woff2"
          multiple
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            try {
              const keys = await addFontFiles(Array.from(files));
              if (keys[0]) onChange(keys[0]);
            } catch {
              onError("Ce fichier de police n'a pas pu être lu (formats acceptés : TTF, OTF, TTC, WOFF, WOFF2).");
            }
            e.target.value = "";
          }}
        />
      </div>
      {status && <p className="font-status ok">{status}</p>}
    </div>
  );
}
