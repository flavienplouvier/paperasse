import { Icon } from "./Icon";
import { t, useLocale } from "../i18n";

interface Props {
  /** Fichiers prêts à partager (le PDF, ou une image par page). */
  files: File[];
  /** Le navigateur refuse les fichiers : ils sont enregistrés à la place. */
  onFallback: (files: File[]) => void;
  onError: (e: unknown) => void;
  onClose: () => void;
}

/**
 * Le navigateur a-t-il un menu de partage ? Oui sur téléphone, Windows et Mac ;
 * non avec Chrome ou Firefox sous Linux. Certains (Firefox sur Android) ne
 * partagent pas les fichiers : voir `shareFiles`.
 */
export function canShare(): boolean {
  return typeof navigator.share === "function";
}

/**
 * Ouvre le menu de partage avec les fichiers. Renvoie false si le navigateur
 * refuse les fichiers (Firefox sur Android) : l'appelant les enregistre alors.
 * Un partage annulé par l'utilisateur est rejeté (AbortError).
 */
export async function shareFiles(files: File[]): Promise<boolean> {
  try {
    await navigator.share({ files, title: files[0]?.name });
    return true;
  } catch (e) {
    const name = (e as Error).name;
    // Annulé, ou clic trop ancien (NotAllowedError) : l'appelant décide.
    if (name === "AbortError" || name === "NotAllowedError") throw e;
    return false;
  }
}

/**
 * Partage après une préparation longue : le navigateur n'ouvre le menu de
 * partage qu'après un clic récent, on le redemande donc ici.
 */
export function ShareDialog({ files, onFallback, onError, onClose }: Props) {
  useLocale();
  const share = async () => {
    try {
      if (!(await shareFiles(files))) onFallback(files);
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
