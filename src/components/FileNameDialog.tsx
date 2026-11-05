import { useState } from "react";
import { Icon } from "./Icon";
import { buildFileName, formatDate, isoDate, loadNamePrefs, saveNamePrefs, type NamePrefs } from "../lib/fileName";

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
  const [prefs, setPrefs] = useState<NamePrefs>(loadNamePrefs);
  const chosenDate = withDate && day ? day : null;
  const fileName = buildFileName({ base: name, date: chosenDate, ...prefs });

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
            <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
            Ajouter une date
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
