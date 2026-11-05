import { useState } from "react";
import { Icon } from "./Icon";
import { t, useLocale } from "../i18n";

interface Props {
  /** PDF prêt à partager (déjà préparé). */
  file: File;
  onDownload: () => void;
  onError: (e: unknown) => void;
  onClose: () => void;
}

/** Le navigateur sait-il partager un fichier (menu de partage du système) ? */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Partage du PDF préparé. Le menu de partage du système s'ouvre depuis un clic
 * dans cette fenêtre : le navigateur l'exige (un partage lancé après la
 * préparation, parfois longue, serait refusé). Sans partage de fichiers
 * (Chrome sous Linux…), on propose l'envoi par e-mail ou le téléchargement.
 */
export function ShareDialog({ file, onDownload, onError, onClose }: Props) {
  useLocale();
  const [mailed, setMailed] = useState(false);
  const native = canShareFile(file);

  const shareNative = async () => {
    try {
      await navigator.share({ files: [file], title: file.name });
      onClose();
    } catch (e) {
      // Partage annulé par l'utilisateur : la fenêtre reste ouverte.
      if ((e as Error).name !== "AbortError") onError(e);
    }
  };

  const mail = () => {
    // Un lien mailto ne peut pas joindre de fichier : il est téléchargé, à joindre au message.
    onDownload();
    const subject = file.name.replace(/\.pdf$/i, "");
    const body = t("Bonjour,\n\nVeuillez trouver ci-joint le document « {name} ».\n", { name: file.name });
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setMailed(true);
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
          <Icon name="pages" size={16} /> {file.name}
        </p>
        {native ? (
          <button className="primary" autoFocus onClick={shareNative}>
            <Icon name="share" size={16} /> {t("Partager…")}
          </button>
        ) : (
          <>
            <p className="hint">{t("Ce navigateur ne sait pas partager un fichier directement (c'est le cas de Chrome et Firefox sous Linux).")}</p>
            <button className="primary" autoFocus onClick={mail}>
              <Icon name="share" size={16} /> {t("Envoyer par e-mail")}
            </button>
            {mailed && <p className="hint">{t("Le fichier a été téléchargé : joignez-le au message qui vient de s'ouvrir.")}</p>}
          </>
        )}
        <div className="modal-row modal-actions">
          <button
            onClick={() => {
              onDownload();
              onClose();
            }}
          >
            <Icon name="extract" size={16} /> {t("Télécharger")}
          </button>
          <button onClick={onClose}>{t("Fermer")}</button>
        </div>
      </div>
    </div>
  );
}
