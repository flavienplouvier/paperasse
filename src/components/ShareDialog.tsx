import { Icon } from "./Icon";
import { t, useLocale } from "../i18n";

interface Props {
  /** Fichiers prêts à partager (le PDF, ou une image par page). */
  files: File[];
  onError: (e: unknown) => void;
  onClose: () => void;
}

/**
 * L'appareil sait-il partager des fichiers (menu de partage du système) ?
 * Oui sur téléphone, Windows et Mac ; non avec Chrome ou Firefox sous Linux.
 */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], "test.pdf", { type: "application/pdf" });
    return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Partage après une préparation longue : le navigateur n'ouvre le menu de
 * partage qu'après un clic récent, on le redemande donc ici.
 */
export function ShareDialog({ files, onError, onClose }: Props) {
  useLocale();
  const share = async () => {
    try {
      await navigator.share({ files, title: files[0]?.name });
      onClose();
    } catch (e) {
      // Partage annulé : la fenêtre reste ouverte.
      if ((e as Error).name !== "AbortError") onError(e);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-dialog" role="dialog" aria-label={t("Partager")} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t("Partager")}</h2>
          <button type="button" className="icon-btn" title={t("Fermer")} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <p className="share-file">
          <Icon name="pages" size={16} /> {files.length === 1 ? files[0].name : t("{n} fichiers", { n: files.length })}
        </p>
        <button className="primary" autoFocus onClick={share}>
          <Icon name="share" size={16} /> {t("Partager…")}
        </button>
      </div>
    </div>
  );
}
