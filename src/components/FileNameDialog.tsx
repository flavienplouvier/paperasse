import { useState } from "react";
import { Icon } from "./Icon";
import { isoDate, scanFileName } from "../lib/scan";

interface Props {
  base: string;
  date: string | null;
  /** Libellé du bouton : « Enregistrer », « Partager »… */
  action: string;
  onConfirm: (fileName: string, base: string, date: string | null) => void;
  onClose: () => void;
}

/** Nom du fichier d'un document numérisé, avec une date facultative (« Facture_2026-11-05.pdf »). */
export function FileNameDialog({ base, date, action, onConfirm, onClose }: Props) {
  const [name, setName] = useState(base);
  const [withDate, setWithDate] = useState(date !== null);
  const [day, setDay] = useState(date ?? isoDate());
  const fileName = scanFileName(name, withDate && day ? day : null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal file-name"
        role="dialog"
        aria-label="Nom du fichier"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(fileName, name.trim() || "Scan", withDate && day ? day : null);
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
          {withDate && day !== isoDate() && (
            <button type="button" className="link" onClick={() => setDay(isoDate())}>
              Aujourd'hui
            </button>
          )}
        </div>
        <p className="file-name-preview" aria-live="polite">
          <Icon name="pages" size={16} /> <span>{fileName}</span>
        </p>
        <div className="modal-row">
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
