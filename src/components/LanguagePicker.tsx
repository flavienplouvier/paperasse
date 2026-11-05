import { useEffect, useRef, useState } from "react";
import { Flag } from "./Flag";
import { t, useLocale } from "../i18n";
import { LANGUAGES, chooseLanguage, flagFor, languageByOcr, type UserLanguage } from "../lib/language";

const flagOf = (ocr: string, current: UserLanguage) => (ocr === current.language.ocr ? current.flag : flagFor(languageByOcr(ocr)));

interface Props {
  value: UserLanguage;
  onChange: (next: UserLanguage) => void;
  /** Affiche le nom de la langue à côté du drapeau. */
  withLabel?: boolean;
  className?: string;
}

/** Drapeau de la langue de l'utilisateur ; un appui ouvre la liste des langues. */
export function LanguagePicker({ value, onChange, withLabel, className = "" }: Props) {
  useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className={`lang-picker ${className}`} ref={ref}>
      <button type="button" className="lang-btn" title={t("Langue : {name}", { name: value.language.native })} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Flag id={value.flag} size={16} />
        {withLabel && <span>{value.language.native}</span>}
      </button>
      {open && (
        <ul className="lang-list" role="listbox" aria-label={t("Langue")}>
          {LANGUAGES.map((l) => (
            <li key={l.ocr}>
              <button
                type="button"
                role="option"
                aria-selected={l.ocr === value.language.ocr}
                className={l.ocr === value.language.ocr ? "active" : ""}
                onClick={() => {
                  setOpen(false);
                  onChange(chooseLanguage(l.ocr));
                }}
              >
                <Flag id={flagOf(l.ocr, value)} size={14} />
                <span lang={l.code}>{l.native}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
