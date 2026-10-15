import { Icon } from "./Icon";

const SHORTCUTS: [string, string][] = [
  ["Ctrl + O", "Ouvrir un fichier"],
  ["Ctrl + S", "Enregistrer"],
  ["Ctrl + Z / Ctrl + Y", "Annuler / rétablir"],
  ["Ctrl + F", "Rechercher"],
  ["Ctrl + molette, Ctrl + / -", "Zoom"],
  ["V", "Sélection"],
  ["E", "Modifier le texte"],
  ["T", "Ajouter du texte"],
  ["D", "Dessin : stylo"],
  ["H", "Dessin : surligneur"],
  ["L / A", "Dessin : trait / flèche"],
  ["R / O", "Formes : rectangle / ellipse"],
  ["W", "Cache blanc"],
  ["P", "Tampon"],
  ["F", "Champ de formulaire"],
  ["Suppr", "Supprimer l'élément sélectionné"],
  ["Échap", "Revenir à la sélection"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Raccourcis clavier">
        <header>
          <h2>Raccourcis clavier</h2>
          <button className="icon-btn" onClick={onClose} title="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([keys, label]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Sur téléphone : pincez à deux doigts pour zoomer.</p>
      </div>
    </div>
  );
}
