import { useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { pageHasText, recognizePages, type OcrLanguage, type OcrProgress } from "../lib/ocr";
import type { OcrWord } from "../lib/ocrLayer";
import { Icon } from "./Icon";
import { t, useLocale } from "../i18n";
import { languageByOcr, ocrChoices, type Language } from "../lib/language";

type Scope = "missing" | "all" | "current";

interface Props {
  pdf: PDFDocumentProxy;
  /** Langue de l'utilisateur, proposée par défaut. */
  language: Language;
  currentPage: number;
  onDone: (pages: Map<number, OcrWord[]>) => Promise<void>;
  onClose: () => void;
  onError: (msg: string) => void;
}

/** Reconnaissance de texte (OCR) : rend un PDF scanné cherchable et sélectionnable. */
export function OcrDialog({ pdf, language, currentPage, onDone, onClose, onError }: Props) {
  useLocale();
  const [scope, setScope] = useState<Scope>("missing");
  const [lang, setLang] = useState<OcrLanguage>(language.ocr);
  const toDownload = lang.split("+").map(languageByOcr).filter((l) => !l.bundled);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    setRunning(true);
    abort.current = new AbortController();
    try {
      let indices: number[];
      if (scope === "current") indices = [currentPage];
      else {
        indices = Array.from({ length: pdf.numPages }, (_, i) => i);
        if (scope === "missing") {
          setProgress({ page: 0, total: pdf.numPages, fraction: 0, status: t("Recherche des pages sans texte") });
          const keep: number[] = [];
          for (const i of indices) if (!(await pageHasText(pdf, i))) keep.push(i);
          indices = keep;
        }
      }
      if (!indices.length) {
        onError(t("Toutes les pages contiennent déjà du texte : rien à reconnaître."));
        return;
      }
      const result = await recognizePages(pdf, indices, lang, setProgress, abort.current.signal);
      if (abort.current.signal.aborted) return;
      const found = [...result.values()].reduce((n, w) => n + w.length, 0);
      if (!found) {
        onError(t("Aucun texte reconnu. Le document est peut-être une image sans texte, ou de trop faible qualité."));
        return;
      }
      await onDone(result);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("La reconnaissance de texte a échoué."));
    } finally {
      setRunning(false);
    }
  };

  const percent = progress ? Math.round(((progress.page - 1 + progress.fraction) / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Reconnaissance de texte")}>
        <header>
          <h2>{t("Reconnaissance de texte (OCR)")}</h2>
          <button className="icon-btn" disabled={running} onClick={onClose} title={t("Fermer")}>
            <Icon name="close" />
          </button>
        </header>
        <p className="hint">
          {t(
            "Rend un PDF scanné cherchable et sélectionnable, et permet d'y utiliser « Modifier le texte ». Le texte reconnu est ajouté de façon invisible sous l'image : l'aspect du document ne change pas. Tout se fait sur cet appareil.",
          )}
        </p>
        <div className="dialog-body">
          <label className="field">
            {t("Pages")}
            <select value={scope} disabled={running} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="missing">{t("Pages sans texte (scans)")}</option>
              <option value="all">{t("Toutes les pages")}</option>
              <option value="current">{t("Page affichée ({n})", { n: currentPage + 1 })}</option>
            </select>
          </label>
          <label className="field">
            {t("Langue du document")}
            <select value={lang} disabled={running} onChange={(e) => setLang(e.target.value as OcrLanguage)}>
              {ocrChoices(language).map((c) => (
                <option key={c.value} value={c.value}>
                  {t(c.label)}
                </option>
              ))}
            </select>
          </label>
          {progress && running && (
            <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar" style={{ width: `${percent}%` }} />
              <span>
                {progress.status}
                {progress.total > 0 && progress.page > 0 ? " — " + t("page {page} / {total}", { page: progress.page, total: progress.total }) : ""} ({percent} %)
              </span>
            </div>
          )}
          <p className="hint">
            {t(
              "Le premier lancement télécharge le moteur de reconnaissance (environ 5 à 8 Mo), ensuite disponible hors ligne. Comptez quelques secondes par page.",
            )}
            {toDownload.length > 0 &&
              " " +
                t("La langue « {language} » est téléchargée à sa première utilisation (2 à 4 Mo), puis gardée sur l'appareil.", {
                  language: t(toDownload[0].label),
                })}
          </p>
        </div>
        <div className="modal-row modal-actions">
          <span className="spacer" />
          {running ? (
            <button onClick={() => abort.current?.abort()}>{t("Arrêter après cette page")}</button>
          ) : (
            <button onClick={onClose}>{t("Annuler")}</button>
          )}
          <button className="primary" disabled={running} onClick={run}>
            {running ? t("Reconnaissance…") : t("Lancer la reconnaissance")}
          </button>
        </div>
      </div>
    </div>
  );
}
