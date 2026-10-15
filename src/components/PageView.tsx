import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from "../lib/pdfjs";
import type { Annotation, Point, Rect, Tool } from "../lib/types";
import { newId } from "../lib/types";
import { addScaled, normalizeRect, screenAxes } from "../lib/geometry";
import { hasRect, simplifyPath, translateAnnotation } from "../lib/annotations";
import { extractRuns, runAt, type TextRun } from "../lib/text";
import { LINE_HEIGHT } from "../lib/exportPdf";
import { getFont } from "../lib/fonts";

export interface ToolStyle {
  color: string;
  width: number;
  opacity: number;
  fill: boolean;
  fontKey: string;
  fontSize: number;
}

export interface EditTextRequest {
  pageId: string;
  run: TextRun;
  page: PDFPageProxy;
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
  const local = (e: React.PointerEvent): Point => {
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
        });
        props.onFocusText();
        break;
      }
      case "image":
        props.onPlace(pageId, p, rotation);
        break;
      case "editText": {
        const run = runs ? runAt(runs, p) : undefined;
        if (run && page) props.onEditText({ pageId, run, page });
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
      if (!tiny) {
        if (tool === "line") {
          props.onCreate({ ...base, kind: "line", from: start, to: end, width: style.width });
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
    setDrag({ mode, pointerId: e.pointerId, start: toPdf(...local(e as React.PointerEvent<SVGSVGElement>)), original: a, corner });
  };

  // ---------------------------------------------------------------- rendu SVG

  const renderAnnotation = (a: Annotation) => {
    const sel = tool === "select";
    const common = {
      opacity: a.opacity,
      style: { pointerEvents: sel ? ("all" as const) : ("none" as const), cursor: sel ? "move" : undefined, touchAction: "none" },
      onPointerDown: (e: React.PointerEvent) => startDrag(e, a, "move"),
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
        const font = getFont(a.fontKey);
        const { bold, italic } = { bold: /bold|gras/i.test(font.label), italic: /italic|oblique|italique/i.test(font.label) };
        return (
          <text
            key={a.id}
            data-annot={a.id}
            {...common}
            x={x}
            y={y}
            fill={a.color}
            fontSize={size}
            fontFamily={font.cssFamily}
            fontWeight={font.source === "standard" && bold ? 700 : undefined}
            fontStyle={font.source === "standard" && italic ? "italic" : undefined}
            transform={`rotate(${rotation - a.rotation} ${x} ${y})`}
            style={{ ...common.style, whiteSpace: "pre", userSelect: "none" }}
          >
            {a.text.split(/\r?\n/).map((line, i) => (
              <tspan key={i} x={x} dy={i === 0 ? 0 : size * LINE_HEIGHT}>
                {line || " "}
              </tspan>
            ))}
          </text>
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
    if (tool === "line") {
      const a = toView(draft.start);
      const b = toView(draft.end);
      return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={style.color} strokeWidth={style.width * scale} strokeLinecap="round" />;
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
        {selBox && tool === "select" && (
          <rect className="selection" x={selBox.x - 4} y={selBox.y - 4} width={selBox.width + 8} height={selBox.height + 8} />
        )}
        {resizeHandle}
        {draftEl}
      </svg>
      <div className="page-number">{index + 1}</div>
    </div>
  );

  function applyDrag(d: NonNullable<Drag>, dx: number, dy: number, p: Point): Annotation {
    if (d.mode === "move" || !d.corner || !hasRect(d.original)) return translateAnnotation(d.original, dx, dy);
    const r = [...d.original.rect] as Rect;
    r[d.corner[0]] = p[0];
    r[d.corner[1]] = p[1];
    return { ...d.original, rect: normalizeRect([r[0], r[1]], [r[2], r[3]]) };
  }
}

export const PageView = memo(PageViewImpl);
