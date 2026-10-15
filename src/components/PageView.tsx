import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from "../lib/pdfjs";
import type { Annotation, FieldType, Point, Rect, Tool } from "../lib/types";
import { newId } from "../lib/types";
import { addScaled, arrowHead, normalizeRect, rectContains, screenAxes } from "../lib/geometry";
import { hasRect, simplifyPath, translateAnnotation } from "../lib/annotations";
import { extractRuns, runAt, type TextRun } from "../lib/text";
import { LINE_HEIGHT } from "../lib/exportPdf";
import { getFont } from "../lib/fonts";
import { Icon } from "./Icon";
import { displayText, usesEmbedded } from "../lib/embeddedFonts";

export interface ToolStyle {
  color: string;
  width: number;
  opacity: number;
  fill: boolean;
  fontKey: string;
  fontSize: number;
  underline: boolean;
  fieldType: FieldType;
}

export interface EditTextRequest {
  pageId: string;
  run: TextRun;
  page: PDFPageProxy;
  /** Couleur du texte d'origine, estimée d'après le rendu de la page. */
  color?: string;
  /** Couleur du fond autour du texte (pour le cache qui masque l'original). */
  background?: string;
}

interface Props {
  pdf: PDFDocumentProxy;
  index: number;
  pageId: string;
  scale: number;
  /** En mode « ajuster à la largeur », largeur maximale d'une page en pixels. */
  maxWidth: number | null;
  tool: Tool;
  style: ToolStyle;
  annotations: Annotation[];
  selectedId: string | null;
  hits: Rect[];
  activeHit: Rect | null;
  onSelect: (id: string | null) => void;
  onCreate: (a: Annotation) => void;
  onChange: (a: Annotation, commit: boolean) => void;
  onEditText: (req: EditTextRequest) => void;
  onPlace: (pageId: string, at: Point, rotation: number) => void;
  onFocusText: () => void;
  registerElement: (index: number, el: HTMLElement | null) => void;
}

type Draft =
  | { kind: "ink"; points: Point[] }
  | { kind: "shape"; start: Point; end: Point }
  | null;

type Drag = {
  mode: "move" | "resize";
  pointerId: number;
  start: Point;
  original: Annotation;
  corner?: [number, number];
} | null;

const MAX_CANVAS_PIXELS = 16_777_216;

/** Style CSS d'aperçu d'une police (les polices standard n'ont qu'une famille CSS). */
function fontCss(key: string) {
  const font = getFont(key);
  const synthetic = font.source === "standard";
  return {
    fontFamily: font.cssFamily,
    fontWeight: synthetic && font.bold ? 700 : undefined,
    fontStyle: synthetic && font.italic ? "italic" : undefined,
  };
}

/** Outils dans lesquels le texte sélectionné reste éditable sur la page. */
const TEXT_TOOLS = new Set<Tool>(["editText", "text"]);

/** Position de la ligne de base sous le haut d'une ligne CSS (interligne LINE_HEIGHT). */
const BASELINE = (LINE_HEIGHT - 1) / 2 + 0.8;

function PageViewImpl(props: Props) {
  const { pdf, index, pageId, tool, style, annotations, selectedId, maxWidth } = props;
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [visible, setVisible] = useState(false);
  const [runs, setRuns] = useState<TextRun[] | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hoverRun, setHoverRun] = useState<TextRun | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    setPage(null);
    setRuns(null);
    pdf.getPage(index + 1).then((p) => alive && setPage(p));
    return () => {
      alive = false;
    };
  }, [pdf, index]);

  const scale = useMemo(() => {
    if (!page || !maxWidth) return props.scale;
    return Math.min(props.scale, maxWidth / page.getViewport({ scale: 1 }).width);
  }, [page, maxWidth, props.scale]);
  const viewport: PageViewport | null = useMemo(() => (page ? page.getViewport({ scale }) : null), [page, scale]);
  const rotation = viewport?.rotation ?? 0;

  // Rendu paresseux : seules les pages proches de l'écran sont dessinées.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries[0].isIntersecting), {
      rootMargin: "800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    props.registerElement(index, wrapRef.current);
    return () => props.registerElement(index, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page || !viewport) return;
    if (!visible) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = viewport.width * viewport.height * ratio * ratio;
    if (pixels > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const task = page.render({
      canvas,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      annotationMode: pdfjs.AnnotationMode.ENABLE,
    });
    task.promise.catch((e: unknown) => {
      if (!(e instanceof pdfjs.RenderingCancelledException)) console.error(e);
    });
    return () => task.cancel();
  }, [page, viewport, visible]);

  // Couche texte : sélection, copie et recherche.
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container || !page || !viewport || !visible) return;
    container.replaceChildren();
    container.style.setProperty("--scale-factor", String(viewport.scale));
    container.style.setProperty("--total-scale-factor", String(viewport.scale));
    container.style.setProperty("--user-unit", "1");
    const layer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    layer.render().catch(() => undefined);
    return () => layer.cancel();
  }, [page, viewport, visible]);

  useEffect(() => {
    if (!page || runs || !(visible && (tool === "editText" || props.hits.length))) return;
    let alive = true;
    extractRuns(page).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
  }, [page, runs, visible, tool, props.hits.length]);

  // Amène le résultat de recherche actif au centre de l'écran.
  const activeHitRef = useRef<SVGRectElement>(null);
  useEffect(() => {
    if (props.activeHit && viewport) activeHitRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.activeHit, viewport]);

  const toView = (p: Point): Point => (viewport ? (viewport.convertToViewportPoint(p[0], p[1]) as Point) : [0, 0]);
  const toPdf = (x: number, y: number): Point =>
    viewport ? (viewport.convertToPdfPoint(x, y) as Point) : [0, 0];
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const viewRect = (r: Rect) => {
    const a = toView([r[0], r[1]]);
    const b = toView([r[2], r[3]]);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
  };

  // ------------------------------------------------------------------ outils

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewport || e.button > 0) return;
    const [x, y] = local(e);
    const p = toPdf(x, y);
    switch (tool) {
      case "ink":
        svgRef.current!.setPointerCapture(e.pointerId);
        setDraft({ kind: "ink", points: [p] });
        break;
      case "rect":
      case "ellipse":
      case "highlight":
      case "whiteout":
      case "line":
      case "arrow":
      case "field":
        svgRef.current!.setPointerCapture(e.pointerId);
        setDraft({ kind: "shape", start: p, end: p });
        break;
      case "text": {
        const { down } = screenAxes(rotation);
        props.onCreate({
          id: newId("annot"),
          kind: "text",
          pageId,
          color: style.color,
          opacity: style.opacity,
          origin: addScaled(p, down, style.fontSize),
          text: "Texte",
          fontKey: style.fontKey,
          fontSize: style.fontSize,
          rotation,
          underline: style.underline || undefined,
        });
        props.onFocusText();
        break;
      }
      case "image":
      case "stamp":
        props.onPlace(pageId, p, rotation);
        break;
      case "editText": {
        // Ligne déjà modifiée (sous son cache) : on rouvre le texte existant.
        const cover = annotations.find((a) => a.kind === "whiteout" && rectContains(a.rect, p));
        if (cover && cover.kind === "whiteout") {
          const existing = annotations.find((a) => a.kind === "text" && rectContains(cover.rect, a.origin, 2));
          if (existing) {
            props.onSelect(existing.id);
            break;
          }
        }
        const run = runs ? runAt(runs, p) : undefined;
        if (run && page) {
          const { ink, background } = sampleColors(run.rect);
          props.onEditText({ pageId, run, page, color: ink, background });
        }
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewport) return;
    const [x, y] = local(e);
    const p = toPdf(x, y);
    if (drag && drag.pointerId === e.pointerId) {
      const dx = p[0] - drag.start[0];
      const dy = p[1] - drag.start[1];
      props.onChange(applyDrag(drag, dx, dy, p), false);
      return;
    }
    if (draft?.kind === "ink") {
      const events = "getCoalescedEvents" in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
      const r = svgRef.current!.getBoundingClientRect();
      const pts = (events.length ? events : [e.nativeEvent]).map((ev) => toPdf(ev.clientX - r.left, ev.clientY - r.top));
      setDraft({ kind: "ink", points: [...draft.points, ...pts] });
    } else if (draft?.kind === "shape") {
      setDraft({ ...draft, end: p });
    } else if (tool === "editText" && runs && e.pointerType === "mouse") {
      setHoverRun(runAt(runs, p) ?? null);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag && drag.pointerId === e.pointerId) {
      const p = toPdf(...local(e));
      props.onChange(applyDrag(drag, p[0] - drag.start[0], p[1] - drag.start[1], p), true);
      setDrag(null);
      return;
    }
    if (!draft) return;
    const base = { id: newId("annot"), pageId, color: style.color, opacity: style.opacity };
    if (draft.kind === "ink") {
      const points = simplifyPath(draft.points, 0.4 / scale + 0.15);
      props.onCreate({ ...base, kind: "ink", points, width: style.width });
    } else {
      const { start, end } = draft;
      const tiny = Math.hypot(end[0] - start[0], end[1] - start[1]) < 2;
      if (tool === "field") {
        // Un simple clic pose un champ de taille usuelle (en points PDF).
        const size = { text: [180, 22], checkbox: [14, 14], dropdown: [140, 22] }[style.fieldType];
        const { right, down } = screenAxes(rotation);
        const rect = tiny
          ? normalizeRect(start, addScaled(addScaled(start, right, size[0]), down, size[1]))
          : normalizeRect(start, end);
        props.onCreate({
          ...base,
          kind: "field",
          rect,
          fieldType: style.fieldType,
          name: "",
          fontSize: 0,
          options: style.fieldType === "dropdown" ? ["Choix 1", "Choix 2"] : undefined,
        });
        setDraft(null);
        return;
      }
      if (!tiny) {
        if (tool === "line" || tool === "arrow") {
          props.onCreate({ ...base, kind: "line", from: start, to: end, width: style.width, arrow: tool === "arrow" });
        } else if (tool === "highlight") {
          props.onCreate({
            ...base,
            kind: "highlight",
            rect: normalizeRect(start, end),
            width: 0,
            fill: true,
            color: style.color === "#000000" ? "#ffe14d" : style.color,
            opacity: Math.min(style.opacity, 0.45),
          });
        } else if (tool === "whiteout") {
          props.onCreate({ ...base, kind: "whiteout", rect: normalizeRect(start, end), width: 0, fill: true, color: "#ffffff", opacity: 1 });
        } else if (tool === "rect" || tool === "ellipse") {
          props.onCreate({ ...base, kind: tool, rect: normalizeRect(start, end), width: style.width, fill: style.fill });
        }
      }
    }
    setDraft(null);
  };

  const startDrag = (e: React.PointerEvent, a: Annotation, mode: "move" | "resize", corner?: [number, number]) => {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    props.onSelect(a.id);
    svgRef.current!.setPointerCapture(e.pointerId);
    setDrag({ mode, pointerId: e.pointerId, start: toPdf(...local(e)), original: a, corner });
  };

  // ---------------------------------------------------------------- rendu SVG

  const renderAnnotation = (a: Annotation) => {
    const sel = tool === "select";
    // En modes texte, un texte déjà ajouté ou modifié se rouvre d'un clic.
    const reopen = a.kind === "text" && TEXT_TOOLS.has(tool);
    const common = {
      opacity: a.opacity,
      style: {
        pointerEvents: sel || reopen ? ("all" as const) : ("none" as const),
        cursor: sel ? "move" : reopen ? "text" : undefined,
        touchAction: "none",
      },
      onPointerDown: (e: React.PointerEvent) => {
        if (reopen) {
          e.stopPropagation();
          // Empêche le navigateur de reprendre le focus (mousedown) : la zone de saisie le garde.
          e.preventDefault();
          props.onSelect(a.id);
          return;
        }
        startDrag(e, a, "move");
      },
      onDoubleClick: () => a.kind === "text" && props.onFocusText(),
    };
    switch (a.kind) {
      case "ink": {
        const pts = a.points.map((p) => toView(p).join(",")).join(" ");
        return (
          <g key={a.id} data-annot={a.id} {...common}>
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(14, a.width * scale)} />
            <polyline points={pts} fill="none" stroke={a.color} strokeWidth={a.width * scale} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      }
      case "line": {
        const f = toView(a.from);
        const t = toView(a.to);
        return (
          <g key={a.id} data-annot={a.id} {...common}>
            <line x1={f[0]} y1={f[1]} x2={t[0]} y2={t[1]} stroke="transparent" strokeWidth={14} />
            <line x1={f[0]} y1={f[1]} x2={t[0]} y2={t[1]} stroke={a.color} strokeWidth={a.width * scale} strokeLinecap="round" />
            {a.arrow &&
              arrowHead(a.from, a.to, a.width).map((p, i) => {
                const h = toView(p);
                return (
                  <line key={i} x1={t[0]} y1={t[1]} x2={h[0]} y2={h[1]} stroke={a.color} strokeWidth={a.width * scale} strokeLinecap="round" />
                );
              })}
          </g>
        );
      }
      case "rect":
      case "highlight":
      case "whiteout": {
        const r = viewRect(a.rect);
        const filled = a.kind !== "rect" || a.fill;
        return (
          <rect
            key={a.id}
            data-annot={a.id}
            {...common}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill={filled ? a.color : "transparent"}
            stroke={filled ? "none" : a.color}
            strokeWidth={a.width * scale}
            style={{ ...common.style, mixBlendMode: a.kind === "highlight" ? "multiply" : undefined }}
          />
        );
      }
      case "ellipse": {
        const r = viewRect(a.rect);
        return (
          <ellipse
            key={a.id}
            data-annot={a.id}
            {...common}
            cx={r.x + r.w / 2}
            cy={r.y + r.h / 2}
            rx={r.w / 2}
            ry={r.h / 2}
            fill={a.fill ? a.color : "transparent"}
            stroke={a.fill ? "none" : a.color}
            strokeWidth={a.width * scale}
          />
        );
      }
      case "text": {
        const [x, y] = toView(a.origin);
        const size = a.fontSize * scale;
        // Police incorporée d'origine si tous les caractères y figurent.
        const original = usesEmbedded(a) ? a.embedded : null;
        const css = original ? { fontFamily: original.cssFamily } : fontCss(a.fontKey);
        return (
          <text
            key={a.id}
            data-annot={a.id}
            {...common}
            x={x}
            y={y}
            fill={a.color}
            fontSize={size}
            fontFamily={css.fontFamily}
            fontWeight={"fontWeight" in css ? css.fontWeight : undefined}
            fontStyle={"fontStyle" in css ? css.fontStyle : undefined}
            transform={`rotate(${rotation - a.rotation} ${x} ${y})`}
            textDecoration={a.underline ? "underline" : undefined}
            style={{ ...common.style, whiteSpace: "pre", userSelect: "none" }}
          >
            {a.text.split(/\r?\n/).map((line, i) => (
              <tspan key={i} x={x} dy={i === 0 ? 0 : size * LINE_HEIGHT}>
                {(original ? displayText(original, line) : line) || " "}
              </tspan>
            ))}
          </text>
        );
      }
      case "field": {
        const r = viewRect(a.rect);
        const label = a.fieldType === "checkbox" ? "☐" : a.fieldType === "dropdown" ? `${a.name || "liste"} ▾` : a.name || "texte";
        const size = Math.max(8, Math.min(r.h * 0.6, 13));
        return (
          <g key={a.id} data-annot={a.id} {...common}>
            <rect className="field-box" x={r.x} y={r.y} width={r.w} height={r.h} />
            {a.fieldType !== "checkbox" && r.w > 24 && (
              <text className="field-label" x={r.x + 4} y={r.y + r.h / 2 + size * 0.35} fontSize={size}>
                {label}
              </text>
            )}
          </g>
        );
      }
      case "image": {
        const w = (a.rect[2] - a.rect[0]) * scale;
        const h = (a.rect[3] - a.rect[1]) * scale;
        const [cx, cy] = toView([(a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2]);
        return (
          <image
            key={a.id}
            data-annot={a.id}
            {...common}
            href={a.dataUrl}
            x={cx - w / 2}
            y={cy - h / 2}
            width={w}
            height={h}
            preserveAspectRatio="none"
            transform={`rotate(${rotation} ${cx} ${cy})`}
          />
        );
      }
    }
  };

  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const editing = (tool === "select" || TEXT_TOOLS.has(tool)) && selected?.kind === "text" ? selected : null;
  const editStart = useRef<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Focus après la fin du clic (le navigateur déplace sinon le focus sur la page),
  // curseur en fin de texte.
  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => {
      const t = editorRef.current;
      if (!t || document.activeElement === t) return;
      t.focus({ preventScroll: true });
      // Texte tout juste ajouté : tout sélectionner pour que la frappe remplace « Texte ».
      if (t.value === "Texte") t.select();
      else t.setSelectionRange(t.value.length, t.value.length);
    }, 30);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);
  const grip = useRef<{ pointerId: number; start: Point; original: Annotation } | null>(null);

  const inlineEditor = (() => {
    if (!editing || !viewport) return null;
    const a = editing;
    const [x, y] = toView(a.origin);
    const size = a.fontSize * scale;
    const asc = size * BASELINE;
    const lines = a.text.split(/\r?\n/);
    const gripMove = (e: React.PointerEvent, final: boolean) => {
      const g = grip.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const p = toPdf(...local(e));
      props.onChange(translateAnnotation(g.original, p[0] - g.start[0], p[1] - g.start[1]), final);
      if (final) grip.current = null;
    };
    return (
      <div
        // Une zone par texte : changer de texte la recrée et lui redonne le focus.
        key={a.id}
        className="inline-text"
        style={{
          left: x,
          top: y - asc,
          transform: `rotate(${rotation - a.rotation}deg)`,
          transformOrigin: `0 ${asc}px`,
        }}
      >
        <button
          className="move-grip"
          title="Déplacer le texte"
          aria-label="Déplacer le texte"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            grip.current = { pointerId: e.pointerId, start: toPdf(...local(e)), original: a };
          }}
          onPointerMove={(e) => gripMove(e, false)}
          onPointerUp={(e) => gripMove(e, true)}
          onPointerCancel={() => (grip.current = null)}
        >
          <Icon name="move" size={16} />
        </button>
        <textarea
          ref={editorRef}
          spellCheck
          value={a.text}
          rows={lines.length}
          cols={Math.max(2, ...lines.map((l) => l.length))}
          // Texte de saisie transparent : le rendu visible reste celui de la page
          // (police incorporée comprise) ; seuls le curseur et la sélection s'affichent.
          style={{ ...fontCss(a.fontKey), fontSize: size, lineHeight: LINE_HEIGHT, color: "transparent" }}
          onFocus={(e) => (editStart.current = e.target.value)}
          onChange={(e) => props.onChange({ ...a, text: e.target.value }, false)}
          onBlur={(e) => {
            if (editStart.current !== e.target.value) props.onChange({ ...a, text: e.target.value }, true);
            editStart.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.blur();
              props.onSelect(null);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>
    );
  })();
  const [selBox, setSelBox] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selected || !svgRef.current) return setSelBox(null);
    const el = svgRef.current.querySelector<SVGGraphicsElement>(`[data-annot="${selected.id}"]`);
    if (!el) return setSelBox(null);
    const box = el.getBBox();
    if (selected.kind === "text" || selected.kind === "image") {
      // getBBox ignore la rotation propre à l'élément : on utilise l'écran.
      const outer = el.getBoundingClientRect();
      const svgBox = svgRef.current.getBoundingClientRect();
      setSelBox(new DOMRect(outer.left - svgBox.left, outer.top - svgBox.top, outer.width, outer.height));
    } else setSelBox(box);
  }, [selected, viewport]);

  const resizeHandle = (() => {
    if (!selected || !hasRect(selected) || tool !== "select") return null;
    const r = selected.rect;
    const corners: [number, number][] = [
      [0, 1],
      [2, 1],
      [0, 3],
      [2, 3],
    ];
    let best = corners[0];
    let bestScore = -Infinity;
    for (const c of corners) {
      const v = toView([r[c[0]], r[c[1]]]);
      if (v[0] + v[1] > bestScore) {
        bestScore = v[0] + v[1];
        best = c;
      }
    }
    const v = toView([r[best[0]], r[best[1]]]);
    return (
      <circle
        className="handle"
        cx={v[0]}
        cy={v[1]}
        r={9}
        onPointerDown={(e) => startDrag(e, selected, "resize", best)}
      />
    );
  })();

  const draftEl = (() => {
    if (!draft) return null;
    if (draft.kind === "ink") {
      return (
        <polyline
          points={draft.points.map((p) => toView(p).join(",")).join(" ")}
          fill="none"
          stroke={style.color}
          strokeOpacity={style.opacity}
          strokeWidth={style.width * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    if (tool === "line" || tool === "arrow") {
      const a = toView(draft.start);
      const b = toView(draft.end);
      const heads = tool === "arrow" ? arrowHead(draft.start, draft.end, style.width).map(toView) : [];
      return (
        <g stroke={style.color} strokeWidth={style.width * scale} strokeLinecap="round">
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
          {heads.map((h, i) => (
            <line key={i} x1={b[0]} y1={b[1]} x2={h[0]} y2={h[1]} />
          ))}
        </g>
      );
    }
    const r = viewRect(normalizeRect(draft.start, draft.end));
    if (tool === "ellipse") {
      return <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} className="draft" />;
    }
    return <rect x={r.x} y={r.y} width={r.w} height={r.h} className="draft" />;
  })();

  const width = viewport?.width ?? 595 * scale;
  const height = viewport?.height ?? 842 * scale;
  const drawing = tool !== "select";

  return (
    <div
      ref={wrapRef}
      className="page"
      data-page-index={index}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} style={{ width, height }} />
      <div ref={textLayerRef} className="textLayer" style={{ pointerEvents: drawing ? "none" : undefined }} />
      <svg
        ref={svgRef}
        className={`overlay tool-${tool}`}
        width={width}
        height={height}
        style={{ pointerEvents: drawing || drag ? "auto" : "none", touchAction: drawing ? "none" : "pan-x pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDraft(null);
          setDrag(null);
        }}
        onPointerLeave={() => setHoverRun(null)}
      >
        {props.hits.map((h, i) => {
          const r = viewRect(h);
          return <rect key={i} className="hit" x={r.x} y={r.y} width={r.w} height={r.h} />;
        })}
        {props.activeHit && (() => {
          const r = viewRect(props.activeHit);
          return <rect ref={activeHitRef} className="hit active" x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} />;
        })()}
        {tool === "editText" &&
          runs?.map((run, i) => {
            const r = viewRect(run.rect);
            return <rect key={i} className={`run ${run === hoverRun ? "hover" : ""}`} x={r.x} y={r.y} width={r.w} height={r.h} />;
          })}
        {annotations.filter((a) => a.kind === "whiteout").map(renderAnnotation)}
        {annotations.filter((a) => a.kind !== "whiteout").map(renderAnnotation)}
        {selBox && tool === "select" && !editing && (
          <rect className="selection" x={selBox.x - 4} y={selBox.y - 4} width={selBox.width + 8} height={selBox.height + 8} />
        )}
        {resizeHandle}
        {draftEl}
      </svg>
      {inlineEditor}
      <div className="page-number">{index + 1}</div>
    </div>
  );

  /** Pixel le plus éloigné du fond dans la zone du texte : sa couleur d'encre. */
  /**
   * Couleurs d'un texte d'après le rendu de la page :
   *  - fond : couleur la plus fréquente sur le pourtour de la zone (fond coloré
   *    d'un tableau, d'un bandeau…), pour que le cache se fonde dans la page ;
   *  - encre : pixel de la zone le plus éloigné de ce fond.
   */
  function sampleColors(rect: Rect): { ink?: string; background?: string } {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !viewport) return {};
    const r = viewRect(rect);
    const k = canvas.width / viewport.width;
    const margin = Math.max(2, Math.round(3 * k));
    const x = Math.max(0, Math.floor(r.x * k) - margin);
    const y = Math.max(0, Math.floor(r.y * k) - margin);
    const w = Math.min(canvas.width - x, Math.ceil(r.w * k) + 2 * margin);
    const h = Math.min(canvas.height - y, Math.ceil(r.h * k) + 2 * margin);
    if (w <= 2 || h <= 2) return {};
    const data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(x, y, w, h).data;
    const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

    // Fond : pixels du pourtour regroupés par couleur approchée, groupe majoritaire moyenné.
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    const visit = (px: number, py: number) => {
      const i = (py * w + px) * 4;
      if (data[i + 3] === 0) return;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const s = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      s.n++;
      s.r += data[i];
      s.g += data[i + 1];
      s.b += data[i + 2];
      buckets.set(key, s);
    };
    for (let px = 0; px < w; px++) {
      visit(px, 0);
      visit(px, h - 1);
    }
    for (let py = 1; py < h - 1; py++) {
      visit(0, py);
      visit(w - 1, py);
    }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    const bg = top ? [top.r / top.n, top.g / top.n, top.b / top.n] : [255, 255, 255];

    let best = -1;
    let ink = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (d > best) {
        best = d;
        ink = [data[i], data[i + 1], data[i + 2]];
      }
    }
    return { background: hex(bg), ink: best >= 60 ? hex(ink) : undefined };
  }

  function applyDrag(d: NonNullable<Drag>, dx: number, dy: number, p: Point): Annotation {
    if (d.mode === "move" || !d.corner || !hasRect(d.original)) return translateAnnotation(d.original, dx, dy);
    const r = [...d.original.rect] as Rect;
    r[d.corner[0]] = p[0];
    r[d.corner[1]] = p[1];
    return { ...d.original, rect: normalizeRect([r[0], r[1]], [r[2], r[3]]) };
  }
}

export const PageView = memo(PageViewImpl);
