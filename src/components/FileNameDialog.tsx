import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t, useLocale } from "../i18n";
import { SAVE_FORMATS, canSave, formatInfo, type SaveFormat } from "../lib/imageExport";
import { parsePageRanges } from "../lib/pageRanges";
import { buildFileName, findDate, formatDate, isoDate, loadNamePrefs, saveNamePrefs, type NamePrefs } from "../lib/fileName";

interface Props {
  /** Nom proposé (sans date ni extension). */
  base: string;
  /** Date proposée (AAAA-MM-JJ), null pour ne pas en mettre par défaut. */
  date: string | null;
  /** Libellé du bouton : « Enregistrer », « Partager »… */
  action: string;
  /** Titre de la fenêtre : « Enregistrement du fichier »… */
  title: string;
  /** `pages` : numéros des pages choisies (à partir de 1), null pour toutes. */
  onConfirm: (fileName: string, base: string, date: string | null, format: SaveFormat, pages: number[] | null) => void;
  onClose: () => void;
  /** Choix du format (PDF ou image) : document numérisé ou fait d'images. */
  formats?: boolean;
  /** Nombre de pages du document : choix des pages à enregistrer (comme à l'impression). */
  pageCount?: number;
}

/** Choix du nom du fichier à l'enregistrement, avec une date facultative. */
export function FileNameDialog({ base, date, action, title, onConfirm, onClose, formats, pageCount = 1 }: Props) {
  useLocale();
  const [format, setFormat] = useState<SaveFormat>("pdf");
  const [supported, setSupported] = useState<Partial<Record<SaveFormat, boolean>>>({});
  useEffect(() => {
    if (!formats) return;
    let alive = true;
    Promise.all(SAVE_FORMATS.map(async (f) => [f.id, await canSave(f.id)] as const)).then((list) => alive && setSupported(Object.fromEntries(list)));
    return () => {
      alive = false;
    };
  }, [formats]);
  const ext = formatInfo(format).ext;
  // Pages : toutes, ou une saisie comme à l'impression (« 1,3 », « 1-3 »).
  const [range, setRange] = useState(`1-${pageCount}`);
  const chosen = parsePageRanges(range, pageCount);
  const invalid = pageCount > 1 && !chosen;
  const count = chosen?.length ?? pageCount;
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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          onConfirm(fileName, name.trim(), chosenDate, format, chosen && chosen.length < pageCount ? chosen : null);
        }}
      >
        <header>
          <h2>{title}</h2>
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
          <div className="save-format-head">
            <span>{t("Format")}</span>
            <InfoTip label={t("Les formats expliqués")} title={t("Quel format choisir ?")} wide>
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
              {pageCount > 1 && <p className="hint">{t("En image, chaque page devient un fichier séparé.")}</p>}
            </InfoTip>
            <select value={format} aria-label={t("Format")} onChange={(e) => setFormat(e.target.value as SaveFormat)}>
              {SAVE_FORMATS.map((f) => (
                <option key={f.id} value={f.id} disabled={supported[f.id] === false}>
                  {f.label}
                  {supported[f.id] === false ? ` — ${t("Non pris en charge par ce navigateur.")}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {pageCount > 1 && (
          <fieldset className="save-pages" aria-label={t("Pages")}>
            <div className="save-format-head">
              <span>{t("Pages")}</span>
              <InfoTip label={t("Choisir les pages")} title={t("Choisir les pages")}>
                <p>{t("Comme pour imprimer : séparez les pages par des virgules et indiquez une suite de pages avec un tiret.")}</p>
                <dl>
                  <div>
                    <dt>1,3</dt>
                    <dd>{t("pages 1 et 3")}</dd>
                  </div>
                  <div>
                    <dt>1-3</dt>
                    <dd>{t("pages 1 à 3")}</dd>
                  </div>
                  <div>
                    <dt>1-3, 6</dt>
                    <dd>{t("pages 1 à 3, puis la page 6")}</dd>
                  </div>
                  <div>
                    <dt>4-</dt>
                    <dd>{t("de la page 4 jusqu'à la fin")}</dd>
                  </div>
                </dl>
              </InfoTip>
              <input
                type="text"
                value={range}
                placeholder={`1-${pageCount}`}
                aria-label={t("Pages à enregistrer")}
                aria-invalid={invalid}
                onChange={(e) => setRange(e.target.value)}
              />
            </div>
            {invalid && <p className="hint error">{t("Pages invalides : le document a {n} pages.", { n: pageCount })}</p>}
          </fieldset>
        )}
        <p className="file-name-preview" aria-live="polite">
          <Icon name="pages" size={16} />{" "}
          <span>
            {fileName.slice(0, -4)}
            <span className="nowrap">
              {format !== "pdf" && count > 1 ? `-${chosen?.[0] ?? 1}` : ""}.{ext}
            </span>
          </span>
        </p>
        <div className="modal-row modal-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t("Annuler")}
          </button>
          <button type="submit" className="primary" disabled={invalid}>
            {action}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Petite icône d'aide bleue : au survol sur ordinateur, une bulle ; au toucher
 * sur téléphone, une fenêtre au centre de l'écran.
 */
function InfoTip({ label, title, wide, children }: { label: string; title: string; wide?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`format-info ${open ? "open" : hover ? "hover" : ""}`}
        title={label}
        aria-label={label}
        aria-expanded={open}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={() => setHover(false)}
        // À la souris, la bulle suffit ; au toucher, fenêtre d'aide.
        onClick={(e) => {
          if ((e.nativeEvent as PointerEvent).pointerType === "mouse") return;
          setOpen((o) => !o);
        }}
      >
        <Icon name="info" size={18} />
      </button>
      <div className={`format-help ${wide ? "wide" : ""}`} role="tooltip" onClick={() => setOpen(false)}>
        <div className="format-help-card" onClick={(e) => e.stopPropagation()}>
          <header>
            <strong>{title}</strong>
            <button type="button" className="icon-btn" title={t("Fermer")} onClick={() => setOpen(false)}>
              <Icon name="close" size={16} />
            </button>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}
