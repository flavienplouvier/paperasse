import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t, useLocale } from "../i18n";
import { SAVE_FORMATS, canSave, formatInfo, type SaveFormat } from "../lib/imageExport";
import { buildFileName, findDate, formatDate, isoDate, loadNamePrefs, saveNamePrefs, type NamePrefs } from "../lib/fileName";

interface Props {
  /** Nom proposé (sans date ni extension). */
  base: string;
  /** Date proposée (AAAA-MM-JJ), null pour ne pas en mettre par défaut. */
  date: string | null;
  /** Libellé du bouton : « Enregistrer », « Partager »… */
  action: string;
  onConfirm: (fileName: string, base: string, date: string | null, format: SaveFormat) => void;
  onClose: () => void;
  /** Document numérisé : choix du format (PDF ou image), avec le nombre de pages. */
  formats?: { pages: number };
}

/** Choix du nom du fichier à l'enregistrement, avec une date facultative. */
export function FileNameDialog({ base, date, action, onConfirm, onClose, formats }: Props) {
  useLocale();
  const [format, setFormat] = useState<SaveFormat>("pdf");
  const [supported, setSupported] = useState<Partial<Record<SaveFormat, boolean>>>({});
  const [help, setHelp] = useState(false);
  /** Survol à la souris (ordinateur) : l'aide s'affiche en bulle sous l'icône. */
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!formats) return;
    let alive = true;
    Promise.all(SAVE_FORMATS.map(async (f) => [f.id, await canSave(f.id)] as const)).then((list) => alive && setSupported(Object.fromEntries(list)));
    return () => {
      alive = false;
    };
  }, [formats]);
  const ext = formatInfo(format).ext;
  const [name, setName] = useState(base);
  const [withDate, setWithDate] = useState(date !== null);
  const [day, setDay] = useState(date ?? isoDate());
  const [prefs, setPrefs] = useState<NamePrefs>(() => {
    // Nom déjà daté : on garde son séparateur pour que le nom reste identique tant qu'on n'y touche pas.
    const prefs = loadNamePrefs();
    const f = date === null ? findDate(base) : null;
    return f && f.underscores !== null ? { ...prefs, underscores: f.underscores } : prefs;
  });
  /** Nom d'origine et nom sans sa date, quand la date du nom a été retirée pour la remplacer. */
  const [replaced, setReplaced] = useState<{ original: string; rest: string } | null>(null);
  /** Date déjà écrite dans le nom (« Facture_2025-03-01 ») : elle peut être remplacée. */
  const found = withDate ? null : findDate(name);
  const chosenDate = withDate && day ? day : null;
  const fileName = buildFileName({ base: name, date: chosenDate, ...prefs });

  const toggleDate = (on: boolean) => {
    if (on && found) {
      // La date du nom est retirée ; la nouvelle reprend son format, sa place et son séparateur.
      setReplaced({ original: name, rest: found.rest });
      setName(found.rest);
      setPrefs((p) => ({
        ...p,
        format: found.format,
        position: found.position,
        ...(found.underscores !== null ? { underscores: found.underscores } : {}),
      }));
      setDay(isoDate());
    }
    if (!on && replaced) {
      // Nom non retouché depuis : on remet l'ancienne date.
      if (name === replaced.rest) setName(replaced.original);
      setReplaced(null);
    }
    setWithDate(on);
  };

  const change = (patch: Partial<NamePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveNamePrefs(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal file-name"
        role="dialog"
        aria-label={t("Nom du fichier")}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(fileName, name.trim(), chosenDate, format);
        }}
      >
        <header>
          <h2>{t("Nom du fichier")}</h2>
          <button type="button" className="icon-btn" title={t("Fermer")} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="field">
          <span>{t("Nom")}</span>
          <input autoFocus value={name} placeholder={t("Ex. Facture électricité")} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-row">
          <label className="check">
            <input type="checkbox" checked={withDate} onChange={(e) => toggleDate(e.target.checked)} />
            {found || replaced ? t("Remplacer la date") : t("Ajouter une date")}
          </label>
          <input type="date" value={day} disabled={!withDate} aria-label={t("Date")} onChange={(e) => setDay(e.target.value)} />
        </div>
        {withDate && (
          <div className="modal-row name-switches">
            <button type="button" className="switch-btn" title={t("Changer l'ordre de la date")} onClick={() => change({ format: prefs.format === "iso" ? "fr" : "iso" })}>
              <Icon name="swap" size={16} /> {formatDate(day || isoDate(), prefs.format)}
            </button>
            <button type="button" className="switch-btn" title={t("Placer la date au début ou à la fin du nom")} onClick={() => change({ position: prefs.position === "end" ? "start" : "end" })}>
              <Icon name="swap" size={16} /> {prefs.position === "end" ? t("Date à la fin") : t("Date au début")}
            </button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={prefs.underscores} onChange={(e) => change({ underscores: e.target.checked })} />
          {t("Remplacer les espaces par « _ »")}
        </label>
        {formats && (
          <div className="save-format">
            <div className="save-format-head">
              <span>{t("Format")}</span>
              {/* Aide : au survol sur ordinateur, au toucher sur téléphone. */}
              <button
                type="button"
                className={`format-info ${help ? "open" : hover ? "hover" : ""}`}
                title={t("Les formats expliqués")}
                aria-label={t("Les formats expliqués")}
                aria-expanded={help}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
                onPointerLeave={() => setHover(false)}
                // Au toucher (téléphone) : fenêtre d'aide. À la souris, la bulle suffit.
                onClick={(e) => {
                  if ((e.nativeEvent as PointerEvent).pointerType === "mouse") return;
                  setHelp((h) => !h);
                }}
              >
                <Icon name="info" size={16} />
              </button>
              <div className="format-help" role="tooltip" onClick={() => setHelp(false)}>
                <div className="format-help-card" onClick={(e) => e.stopPropagation()}>
                  <header>
                    <strong>{t("Quel format choisir ?")}</strong>
                    <button type="button" className="icon-btn" title={t("Fermer")} onClick={() => setHelp(false)}>
                      <Icon name="close" size={16} />
                    </button>
                  </header>
                  <dl>
                    {SAVE_FORMATS.map((f) => (
                      <div key={f.id}>
                        <dt>{f.label}</dt>
                        <dd>
                          {t(f.help)}
                          {supported[f.id] === false && <em> {t("Non pris en charge par ce navigateur.")}</em>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {formats.pages > 1 && <p className="hint">{t("En image, chaque page devient un fichier séparé.")}</p>}
                </div>
              </div>
            </div>
            <div className="format-chips" role="radiogroup" aria-label={t("Format")}>
              {SAVE_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={format === f.id}
                  className={format === f.id ? "on" : ""}
                  disabled={supported[f.id] === false}
                  title={supported[f.id] === false ? t("Non pris en charge par ce navigateur.") : t(f.help)}
                  onClick={() => setFormat(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="file-name-preview" aria-live="polite">
          <Icon name="pages" size={16} />{" "}
          <span>
            {fileName.slice(0, -4)}
            <span className="nowrap">
              {formats && format !== "pdf" && formats.pages > 1 ? "-1" : ""}.{ext}
            </span>
          </span>
        </p>
        <div className="modal-row modal-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t("Annuler")}
          </button>
          <button type="submit" className="primary">
            {action}
          </button>
        </div>
      </form>
    </div>
  );
}
