import { useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { pageHasText, recognizePages, type OcrLanguage, type OcrProgress } from "../lib/ocr";
import type { OcrWord } from "../lib/ocrLayer";
import { Icon } from "./Icon";

type Scope = "missing" | "all" | "current";

interface Props {
  pdf: PDFDocumentProxy;
  currentPage: number;
  onDone: (pages: Map<number, OcrWord[]>) => Promise<void>;
  onClose: () => void;
  onError: (msg: string) => void;
}

/** Reconnaissance de texte (OCR) : rend un PDF scanné cherchable et sélectionnable. */
export function OcrDialog({ pdf, currentPage, onDone, onClose, onError }: Props) {
  const [scope, setScope] = useState<Scope>("missing");
  const [lang, setLang] = useState<OcrLanguage>("fra");
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
          setProgress({ page: 0, total: pdf.numPages, fraction: 0, status: "Recherche des pages sans texte" });
          const keep: number[] = [];
          for (const i of indices) if (!(await pageHasText(pdf, i))) keep.push(i);
          indices = keep;
        }
      }
      if (!indices.length) {
        onError("Toutes les pages contiennent déjà du texte : rien à reconnaître.");
        return;
      }
      const result = await recognizePages(pdf, indices, lang, setProgress, abort.current.signal);
      if (abort.current.signal.aborted) return;
      const found = [...result.values()].reduce((n, w) => n + w.length, 0);
      if (!found) {
        onError("Aucun texte reconnu. Le document est peut-être une image sans texte, ou de trop faible qualité.");
        return;
      }
      await onDone(result);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "La reconnaissance de texte a échoué.");
    } finally {
      setRunning(false);
    }
  };

  const percent = progress ? Math.round(((progress.page - 1 + progress.fraction) / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reconnaissance de texte">
        <header>
          <h2>Reconnaissance de texte (OCR)</h2>
          <button className="icon-btn" disabled={running} onClick={onClose} title="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <p className="hint">
          Rend un PDF scanné cherchable et sélectionnable, et permet d'y utiliser « Modifier le texte ». Le texte reconnu
          est ajouté de façon invisible sous l'image : l'aspect du document ne change pas. Tout se fait sur cet appareil.
        </p>
        <div className="dialog-body">
          <label className="field">
            Pages
            <select value={scope} disabled={running} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="missing">Pages sans texte (scans)</option>
              <option value="all">Toutes les pages</option>
              <option value="current">Page affichée ({currentPage + 1})</option>
            </select>
          </label>
          <label className="field">
            Langue du document
            <select value={lang} disabled={running} onChange={(e) => setLang(e.target.value as OcrLanguage)}>
              <option value="fra">Français</option>
              <option value="eng">Anglais</option>
              <option value="fra+eng">Français et anglais</option>
            </select>
          </label>
          {progress && running && (
            <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar" style={{ width: `${percent}%` }} />
              <span>
                {progress.status}
                {progress.total > 0 && progress.page > 0 ? ` — page ${progress.page} / ${progress.total}` : ""} ({percent} %)
              </span>
            </div>
          )}
          <p className="hint">
            Le premier lancement télécharge le moteur de reconnaissance (environ 5 à 8 Mo), ensuite disponible hors ligne.
            Comptez quelques secondes par page.
          </p>
        </div>
        <div className="modal-row">
          <span className="spacer" />
          {running ? (
            <button onClick={() => abort.current?.abort()}>Arrêter après cette page</button>
          ) : (
            <button onClick={onClose}>Annuler</button>
          )}
          <button className="primary" disabled={running} onClick={run}>
            {running ? "Reconnaissance…" : "Lancer la reconnaissance"}
          </button>
        </div>
      </div>
    </div>
  );
}
