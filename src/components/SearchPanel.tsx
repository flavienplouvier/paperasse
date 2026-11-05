import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { extractRuns, searchRuns, type SearchHit } from "../lib/text";
import { t, tn, useLocale } from "../i18n";

interface Props {
  pdf: PDFDocumentProxy;
  onResults: (hits: SearchHit[]) => void;
  onGoto: (hit: SearchHit, index: number) => void;
  active: number;
}

export function SearchPanel({ pdf, onResults, onGoto, active }: Props) {
  useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      onResults([]);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      const all: SearchHit[] = [];
      for (let i = 0; i < pdf.numPages && alive; i++) {
        const page = await pdf.getPage(i + 1);
        all.push(...searchRuns(await extractRuns(page), i, q));
      }
      if (!alive) return;
      setHits(all);
      onResults(all);
      setBusy(false);
      if (all.length) onGoto(all[0], 0);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pdf]);

  const step = (d: number) => {
    if (!hits.length) return;
    const i = (active + d + hits.length) % hits.length;
    onGoto(hits[i], i);
  };

  return (
    <div className="search-panel">
      <div className="search-row">
        <input
          ref={inputRef}
          type="search"
          placeholder={t("Rechercher dans le document…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && step(e.shiftKey ? -1 : 1)}
        />
        <button onClick={() => step(-1)} disabled={!hits.length} title={t("Précédent")}>
          ↑
        </button>
        <button onClick={() => step(1)} disabled={!hits.length} title={t("Suivant")}>
          ↓
        </button>
      </div>
      <div className="panel-sub">
        {busy
          ? t("Recherche…")
          : query.trim().length >= 2
            ? tn("{n} résultat", "{n} résultats", hits.length)
            : t("Au moins 2 caractères")}
      </div>
      <ol className="results">
        {hits.slice(0, 500).map((h, i) => (
          <li key={i} className={i === active ? "active" : ""}>
            <button onClick={() => onGoto(h, i)}>
              <span className="result-page">{t("p. {n}", { n: h.pageIndex + 1 })}</span> {h.context}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
