import { msg, t, useLocale } from "../i18n";
import { Icon } from "./Icon";

const SHORTCUTS: [string, string][] = [
  ["Ctrl + O", msg("Ouvrir un fichier")],
  ["Ctrl + S", msg("Enregistrer")],
  ["Ctrl + Z / Ctrl + Y", msg("Annuler / rétablir")],
  ["Ctrl + F", msg("Rechercher")],
  [msg("Ctrl + molette, Ctrl + / -"), msg("Zoom")],
  ["V", msg("Sélection")],
  ["E", msg("Modifier le texte")],
  ["T", msg("Ajouter du texte")],
  ["D", msg("Dessin : stylo")],
  ["H", msg("Dessin : surligneur")],
  ["L / A", msg("Dessin : trait / flèche")],
  ["R / O", msg("Formes : rectangle / ellipse")],
  ["G", msg("Gomme (supprime les éléments ajoutés)")],
  ["W", msg("Cache blanc (masque le contenu du PDF)")],
  ["P", msg("Tampon")],
  ["F", msg("Champ de formulaire")],
  [msg("Suppr"), msg("Supprimer l'élément sélectionné")],
  [msg("Échap"), msg("Revenir à la sélection")],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Raccourcis clavier")}>
        <header>
          <h2>{t("Raccourcis clavier")}</h2>
          <button className="icon-btn" onClick={onClose} title={t("Fermer")}>
            <Icon name="close" />
          </button>
        </header>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([keys, label]) => (
              <tr key={keys}>
                <td>
                  <kbd>{t(keys)}</kbd>
                </td>
                <td>{t(label)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">{t("Sur téléphone : pincez à deux doigts pour zoomer.")}</p>
      </div>
    </div>
  );
}
