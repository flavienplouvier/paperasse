import { useState } from "react";
import { Icon } from "./Icon";
import { buildFileName, findDate, formatDate, isoDate, loadNamePrefs, saveNamePrefs, type NamePrefs } from "../lib/fileName";

interface Props {
  /** Nom proposé (sans date ni extension). */
  base: string;
  /** Date proposée (AAAA-MM-JJ), null pour ne pas en mettre par défaut. */
  date: string | null;
  /** Libellé du bouton : « Enregistrer », « Partager »… */
  action: string;
  onConfirm: (fileName: string, base: string, date: string | null) => void;
  onClose: () => void;
}

/** Choix du nom du fichier à l'enregistrement, avec une date facultative. */
export function FileNameDialog({ base, date, action, onConfirm, onClose }: Props) {
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
        aria-label="Nom du fichier"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(fileName, name.trim(), chosenDate);
        }}
      >
        <header>
          <h2>Nom du fichier</h2>
          <button type="button" className="icon-btn" title="Fermer" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="field">
          <span>Nom</span>
          <input autoFocus value={name} placeholder="Ex. Facture électricité" onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-row">
          <label className="check">
            <input type="checkbox" checked={withDate} onChange={(e) => toggleDate(e.target.checked)} />
            {found || replaced ? "Remplacer la date" : "Ajouter une date"}
          </label>
          <input type="date" value={day} disabled={!withDate} aria-label="Date" onChange={(e) => setDay(e.target.value)} />
        </div>
        {withDate && (
          <div className="modal-row name-switches">
            <button type="button" className="switch-btn" title="Changer l'ordre de la date" onClick={() => change({ format: prefs.format === "iso" ? "fr" : "iso" })}>
              <Icon name="swap" size={16} /> {formatDate(day || isoDate(), prefs.format)}
            </button>
            <button type="button" className="switch-btn" title="Placer la date au début ou à la fin du nom" onClick={() => change({ position: prefs.position === "end" ? "start" : "end" })}>
              <Icon name="swap" size={16} /> {prefs.position === "end" ? "Date à la fin" : "Date au début"}
            </button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={prefs.underscores} onChange={(e) => change({ underscores: e.target.checked })} />
          Remplacer les espaces par « _ »
        </label>
        <p className="file-name-preview" aria-live="polite">
          <Icon name="pages" size={16} />{" "}
          <span>
            {fileName.slice(0, -4)}
            <span className="nowrap">.pdf</span>
          </span>
        </p>
        <div className="modal-row modal-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary">
            {action}
          </button>
        </div>
      </form>
    </div>
  );
}
