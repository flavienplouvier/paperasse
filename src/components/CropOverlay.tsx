import { useEffect, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import type { Point, Rect } from "../lib/types";
import { normalizeRect } from "../lib/geometry";
import { MIN_CROP } from "../lib/cropPage";
import { Icon } from "./Icon";
import { t } from "../i18n";

/**
 * Outil « Découper » sur une page : on trace un rectangle, on l'ajuste avec les
 * poignées (loupe sous le doigt sur écran tactile), puis on crée la page.
 * La zone est gardée en proportions de la page affichée : elle suit le zoom.
 */

interface Props {
  viewport: PageViewport;
  /** Rendu de la page (pour la loupe). */
  canvas: HTMLCanvasElement | null;
  /** Découpe en image proposée par défaut (page numérisée, photo). */
  imageByDefault: boolean;
  onCrop: (rect: Rect, asImage: boolean) => void;
}

/** Côtés déplacés : -1 = gauche/haut, 1 = droite/bas, 0 = aucun ; « move » = toute la zone. */
type Grip = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } | "move" | "new";

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const GRIPS: [-1 | 0 | 1, -1 | 0 | 1][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const LOUPE = 130;
const ZOOM = 2.5;

export function CropOverlay({ viewport, canvas, imageByDefault, onCrop }: Props) {
  const W = viewport.width;
  const H = viewport.height;
  /** Zone en fractions de la page affichée (0…1). */
  const [box, setBox] = useState<Box | null>(null);
  const [asImage, setAsImage] = useState(imageByDefault);
  const [active, setActive] = useState<{ x: number; y: number; touch: boolean } | null>(null);
  const drag = useRef<{ pointerId: number; grip: Grip; start: Point; orig: Box | null } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => setAsImage(imageByDefault), [imageByDefault]);

  const px = box && { x1: box.x1 * W, y1: box.y1 * H, x2: box.x2 * W, y2: box.y2 * H };

  /** Zone en points PDF. */
  const pdfRect = (b: Box): Rect => {
    const a = viewport.convertToPdfPoint(b.x1 * W, b.y1 * H) as Point;
    const c = viewport.convertToPdfPoint(b.x2 * W, b.y2 * H) as Point;
    return normalizeRect(a, c);
  };
  const big = (b: Box) => {
    const r = pdfRect(b);
    return r[2] - r[0] >= MIN_CROP && r[3] - r[1] >= MIN_CROP;
  };

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current!.getBoundingClientRect();
    return [Math.min(W, Math.max(0, e.clientX - r.left)), Math.min(H, Math.max(0, e.clientY - r.top))];
  };

  const start = (e: React.PointerEvent, grip: Grip) => {
    if (e.button > 0) return;
    e.stopPropagation();
    e.preventDefault();
    rootRef.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    drag.current = { pointerId: e.pointerId, grip, start: p, orig: box };
    if (grip === "new") setBox({ x1: p[0] / W, y1: p[1] / H, x2: p[0] / W, y2: p[1] / H });
    setActive({ x: p[0], y: p[1], touch: e.pointerType !== "mouse" });
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const [x, y] = local(e);
    const fx = x / W;
    const fy = y / H;
    if (d.grip === "new") {
      const sx = d.start[0] / W;
      const sy = d.start[1] / H;
      setBox({ x1: Math.min(sx, fx), y1: Math.min(sy, fy), x2: Math.max(sx, fx), y2: Math.max(sy, fy) });
    } else if (d.grip === "move" && d.orig) {
      const o = d.orig;
      const dx = Math.min(1 - o.x2, Math.max(-o.x1, fx - d.start[0] / W));
      const dy = Math.min(1 - o.y2, Math.max(-o.y1, fy - d.start[1] / H));
      setBox({ x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
    } else if (typeof d.grip === "object" && d.orig) {
      const { sx, sy } = d.grip;
      const b = { ...d.orig };
      if (sx < 0) b.x1 = fx;
      if (sx > 0) b.x2 = fx;
      if (sy < 0) b.y1 = fy;
      if (sy > 0) b.y2 = fy;
      setBox({ x1: Math.min(b.x1, b.x2), y1: Math.min(b.y1, b.y2), x2: Math.max(b.x1, b.x2), y2: Math.max(b.y1, b.y2) });
    }
    setActive((a) => (a ? { ...a, x, y } : a));
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setActive(null);
    // Simple appui sans tracer : pas de zone.
    setBox((b) => (b && (b.x2 - b.x1) * W > 8 && (b.y2 - b.y1) * H > 8 ? b : d.grip === "new" ? null : b));
  };

  // Loupe : agrandissement du rendu de la page autour du doigt.
  useEffect(() => {
    const out = loupeRef.current;
    if (!out || !active || !canvas || !canvas.width) return;
    const ctx = out.getContext("2d")!;
    const k = canvas.width / W;
    const span = LOUPE / ZOOM;
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(canvas, (active.x - span / 2) * k, (active.y - span / 2) * k, span * k, span * k, 0, 0, LOUPE, LOUPE);
  }, [active, canvas, W]);

  useEffect(() => {
    if (!box) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") setBox(null);
      else if (e.key === "Enter" && big(box)) {
        e.preventDefault();
        onCrop(pdfRect(box), asImage);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Loupe au-dessus du doigt (en dessous près du haut de la page), jamais sous lui.
  const loupePos = active && { x: Math.min(W - LOUPE / 2, Math.max(LOUPE / 2, active.x)), y: active.y > LOUPE * 1.3 ? active.y - LOUPE * 0.95 : active.y + LOUPE * 0.95 };

  return (
    <div
      ref={rootRef}
      className="crop-overlay"
      style={{ width: W, height: H }}
      onPointerDown={(e) => start(e, "new")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <svg width={W} height={H}>
        {px ? (
          <>
            <path className="crop-shade" fillRule="evenodd" d={`M0 0H${W}V${H}H0Z M${px.x1} ${px.y1}H${px.x2}V${px.y2}H${px.x1}Z`} />
            <rect className="crop-frame" x={px.x1} y={px.y1} width={px.x2 - px.x1} height={px.y2 - px.y1} onPointerDown={(e) => start(e, "move")} />
            {!(drag.current?.grip === "new") &&
              GRIPS.map(([sx, sy]) => {
                const cx = sx < 0 ? px.x1 : sx > 0 ? px.x2 : (px.x1 + px.x2) / 2;
                const cy = sy < 0 ? px.y1 : sy > 0 ? px.y2 : (px.y1 + px.y2) / 2;
                const cursor = sx === 0 ? "ns-resize" : sy === 0 ? "ew-resize" : sx === sy ? "nwse-resize" : "nesw-resize";
                return (
                  <g key={`${sx}${sy}`} style={{ cursor }} onPointerDown={(e) => start(e, { sx, sy })}>
                    <circle className="crop-grip-hit" cx={cx} cy={cy} r={18} />
                    <circle className="crop-grip" cx={cx} cy={cy} r={sx && sy ? 7 : 5} />
                  </g>
                );
              })}
          </>
        ) : (
          <path className="crop-shade light" d={`M0 0H${W}V${H}H0Z`} />
        )}
      </svg>
      {!box && <div className="crop-hint">{t("Tracez la zone à découper")}</div>}
      {active?.touch && loupePos && (
        <div className="crop-loupe page-loupe" style={{ left: loupePos.x, top: loupePos.y }}>
          <canvas ref={loupeRef} width={LOUPE} height={LOUPE} />
        </div>
      )}
      {box && px && !active && (
        <div
          className="crop-bar"
          style={{ left: (px.x1 + px.x2) / 2, top: px.y2 + 56 < H ? px.y2 + 10 : Math.max(4, px.y1 - 54) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label className="crop-image" title={t("En image, ce qui est hors du cadre est vraiment supprimé. En PDF, le texte reste net et sélectionnable, mais le reste de la page est seulement masqué.")}>
            <input type="checkbox" checked={asImage} onChange={(e) => setAsImage(e.target.checked)} /> {t("En image")}
          </label>
          <button type="button" className="primary" disabled={!big(box)} onClick={() => onCrop(pdfRect(box), asImage)}>
            <Icon name="crop" size={16} /> {t("Créer la page")}
          </button>
          <button type="button" className="icon-btn" title={t("Annuler")} onClick={() => setBox(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
