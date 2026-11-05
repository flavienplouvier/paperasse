import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { Icon } from "./Icon";
import { t, tn, useLocale } from "../i18n";

function Thumb({ pdf, index, onClick }: { pdf: PDFDocumentProxy; index: number; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: { cancel(): void } | null = null;
    let alive = true;
    pdf.getPage(index + 1).then((page) => {
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 220 / base.width });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const render = page.render({ canvas, viewport });
      task = render;
      render.promise.catch(() => undefined);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [pdf, index, visible]);

  return <canvas ref={ref} className="thumb-canvas" width={110} height={150} onClick={onClick} />;
}

interface Props {
  pdf: PDFDocumentProxy;
  pageIds: string[];
  current: number;
  selected: Set<string>;
  editable: boolean;
  onToggle: (id: string) => void;
  onGoto: (index: number) => void;
  onRotate: (delta: number) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onInsertBlank: () => void;
  onExtract: () => void;
  onMerge: () => void;
  onSelectAll: () => void;
}

function ThumbnailsImpl(p: Props) {
  useLocale();
  const count = p.selected.size;
  const disabled = !p.editable || count === 0;
  return (
    <div className="thumbs-panel">
      <div className="panel-actions">
        <button title={t("Tourner à gauche")} disabled={disabled} onClick={() => p.onRotate(-90)}>
          <Icon name="rotateL" />
        </button>
        <button title={t("Tourner à droite")} disabled={disabled} onClick={() => p.onRotate(90)}>
          <Icon name="rotateR" />
        </button>
        <button title={t("Monter")} disabled={disabled || count !== 1} onClick={() => p.onMove(-1)}>
          <Icon name="up" />
        </button>
        <button title={t("Descendre")} disabled={disabled || count !== 1} onClick={() => p.onMove(1)}>
          <Icon name="down" />
        </button>
        <button title={t("Dupliquer")} disabled={disabled || count !== 1} onClick={p.onDuplicate}>
          <Icon name="copy" />
        </button>
        <button title={t("Insérer une page blanche après")} disabled={!p.editable} onClick={p.onInsertBlank}>
          <Icon name="plus" />
        </button>
        <button title={t("Supprimer")} disabled={disabled} onClick={p.onDelete}>
          <Icon name="trash" />
        </button>
        <button title={t("Extraire la sélection dans un nouveau PDF")} disabled={count === 0} onClick={p.onExtract}>
          <Icon name="extract" />
        </button>
        <button title={t("Ajouter des PDF à la fin (fusion)")} disabled={!p.editable} onClick={p.onMerge}>
          <Icon name="merge" />
        </button>
      </div>
      <div className="panel-sub">
        {count > 0
          ? tn("{n} page sélectionnée", "{n} pages sélectionnées", count)
          : t("Touchez la case d'une page pour la sélectionner")}
        <button className="link" onClick={p.onSelectAll}>
          {count === p.pageIds.length ? t("Aucune") : t("Toutes")}
        </button>
      </div>
      <ol className="thumbs">
        {p.pageIds.map((id, i) => (
          <li key={id} className={`${i === p.current ? "current" : ""} ${p.selected.has(id) ? "checked" : ""}`}>
            <Thumb pdf={p.pdf} index={i} onClick={() => p.onGoto(i)} />
            <label className="thumb-label">
              <input type="checkbox" checked={p.selected.has(id)} onChange={() => p.onToggle(id)} />
              {i + 1}
            </label>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const Thumbnails = memo(ThumbnailsImpl);
