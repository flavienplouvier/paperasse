import { useEffect, useState } from "react";
import { FontPicker } from "./FontPicker";
import { t, useLocale } from "../i18n";
import { ensureCssFont, getFont } from "../lib/fonts";
import type { FileFont } from "../lib/fileFonts";

/**
 * Choix de police compact : un bouton affiche la police (dans son propre
 * style) et déroule la même liste que « Modifier le texte » (polices du
 * fichier d'abord, recherche, polices installées ou importées).
 */
export function FontSelect({
  value,
  onChange,
  onError,
  fileFonts,
  sample,
  active,
  color,
}: {
  value: string;
  onChange: (key: string) => void;
  onError: (msg: string) => void;
  fileFonts?: FileFont[];
  /** Texte d'aperçu ; à défaut, le nom de la police. */
  sample?: string;
  active?: boolean;
  color?: string;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [, setReady] = useState(0);
  const font = getFont(value);

  useEffect(() => {
    ensureCssFont(value)
      .then(() => setReady((n) => n + 1))
      .catch(() => undefined);
  }, [value]);

  return (
    <div className={`font-select ${open ? "open" : ""} ${active ? "active" : ""}`}>
      <button type="button" className="font-select-btn" aria-expanded={open} title={t("Choisir une police")} onClick={() => setOpen((o) => !o)}>
        <span className="font-select-sample" style={{ fontFamily: font.cssFamily, color }}>
          {sample || font.label}
        </span>
        <span className="font-select-name">{sample ? font.label : ""} ▾</span>
      </button>
      {open && (
        <div className="font-select-pop">
          <FontPicker
            value={value}
            fileFonts={fileFonts}
            onError={onError}
            onChange={(k) => {
              onChange(k);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
