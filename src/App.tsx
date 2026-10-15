import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { openPdf, PasswordRequired, pdfjs, realFontName, type PDFDocumentProxy } from "./lib/pdfjs";
import type { Annotation, DocState, Point, Rect, Tool } from "./lib/types";
import { newId } from "./lib/types";
import * as ops from "./lib/pageOps";
import { exportPdf } from "./lib/exportPdf";
import { rasterExport } from "./lib/rasterExport";
import { fillForm, type FormValues } from "./lib/forms";
import { DEFAULT_FONT_KEY, ensureCssFont, getFont, matchFont } from "./lib/fonts";
import { duplicateAnnotation } from "./lib/annotations";
import type { SearchHit } from "./lib/text";
import { PageView, type EditTextRequest, type ToolStyle } from "./components/PageView";
import { Thumbnails } from "./components/Thumbnails";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { SearchPanel } from "./components/SearchPanel";
import { FormsPanel } from "./components/FormsPanel";
import { SignaturePad } from "./components/SignaturePad";
import { Icon } from "./components/Icon";

type Snapshot = Pick<DocState, "bytes" | "pageIds" | "annotations">;
type Panel = "pages" | "search" | "forms";

const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: "select", label: "Sélection", icon: "select", key: "v" },
  { id: "editText", label: "Modifier le texte", icon: "editText", key: "e" },
  { id: "text", label: "Ajouter du texte", icon: "text", key: "t" },
  { id: "ink", label: "Dessin", icon: "ink", key: "d" },
  { id: "highlight", label: "Surligner", icon: "highlight", key: "h" },
  { id: "rect", label: "Rectangle", icon: "rect", key: "r" },
  { id: "ellipse", label: "Ellipse", icon: "ellipse", key: "o" },
  { id: "line", label: "Trait", icon: "line", key: "l" },
  { id: "whiteout", label: "Effacer (cache blanc)", icon: "whiteout", key: "w" },
];

const isMobile = () => window.matchMedia("(max-width: 899px)").matches;

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = rej;
    img.src = dataUrl;
  });
}

/** Les images autres que PNG/JPEG (WebP, HEIC converti par le navigateur…) sont réencodées en PNG. */
async function normalizeImage(file: File): Promise<string> {
  const url = await readAsDataUrl(file);
  if (/^data:image\/(png|jpeg)/.test(url)) return url;
  const { w, h } = await imageSize(url);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const img = new Image();
  img.src = url;
  await img.decode();
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c.toDataURL("image/png");
}

async function canRewrite(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [doc, setDoc] = useState<DocState | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const dragBase = useRef<Snapshot | null>(null);
  const [, forceHistory] = useState(0);

  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [fitMax, setFitMax] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [style, setStyle] = useState<ToolStyle>({
    color: "#e5484d",
    width: 2,
    opacity: 1,
    fill: false,
    fontKey: DEFAULT_FONT_KEY,
    fontSize: 14,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(() => (isMobile() ? null : "pages"));
  const [propsOpen, setPropsOpen] = useState(() => !isMobile());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState<{ dataUrl: string; w: number; h: number; signature: boolean } | null>(null);
  const [signing, setSigning] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [focusText, setFocusText] = useState(0);
  const [locked, setLocked] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const viewerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLElement>());
  const openInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), error ? 7000 : 3500);
  }, []);
  const fail = useCallback((e: unknown) => notify(e instanceof Error ? e.message : String(e), true), [notify]);

  // ------------------------------------------------------------- historique

  const snapshot = (d: DocState): Snapshot => ({ bytes: d.bytes, pageIds: d.pageIds, annotations: d.annotations });

  const commit = useCallback((next: Partial<Snapshot>) => {
    setDoc((d) => {
      if (!d) return d;
      past.current.push(dragBase.current ?? snapshot(d));
      if (past.current.length > 100) past.current.shift();
      dragBase.current = null;
      future.current = [];
      return { ...d, ...next };
    });
    forceHistory((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    setDoc((d) => {
      const prev = past.current.pop();
      if (!d || !prev) return d;
      future.current.push(snapshot(d));
      return { ...d, ...prev };
    });
    setSelectedId(null);
    forceHistory((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    setDoc((d) => {
      const next = future.current.pop();
      if (!d || !next) return d;
      past.current.push(snapshot(d));
      return { ...d, ...next };
    });
    setSelectedId(null);
    forceHistory((n) => n + 1);
  }, []);

  // ---------------------------------------------------------------- chargement

  const bytesRef = useRef<Uint8Array | null>(null);
  useEffect(() => {
    if (!doc) return;
    if (bytesRef.current === doc.bytes) return;
    bytesRef.current = doc.bytes;
    let alive = true;
    openPdf(doc.bytes, doc.password)
      .then(async (p) => {
        if (!alive) return p.loadingTask.destroy();
        setPdf((old) => {
          old?.loadingTask.destroy();
          return p;
        });
        const perms = await p.getPermissions();
        const F = pdfjs.PermissionFlag;
        setLocked(
          perms && !perms.has(F.MODIFY_CONTENTS) && !perms.has(F.MODIFY_ANNOTATIONS)
            ? "L'auteur de ce PDF n'autorise pas sa modification : lecture, recherche et copie restent disponibles selon ses permissions."
            : null,
        );
      })
      .catch(fail);
    return () => {
      alive = false;
    };
  }, [doc, fail]);

  const loadDocument = useCallback(
    async (bytes: Uint8Array, name: string) => {
      let password: string | undefined;
      for (;;) {
        try {
          const p = await openPdf(bytes, password);
          const count = p.numPages;
          await p.loadingTask.destroy();
          const rewritable = password ? false : await canRewrite(bytes);
          past.current = [];
          future.current = [];
          bytesRef.current = null;
          setSelectedId(null);
          setSelectedPages(new Set());
          setHits([]);
          setCurrentPage(0);
          setFitWidth(true);
          setDoc({ name, bytes, pageIds: ops.freshPageIds(count), annotations: [], rewritable, password });
          if (!rewritable) {
            notify("PDF protégé ou atypique : l'annotation reste possible, l'export se fera page par page en image.");
          }
          return;
        } catch (e) {
          if (e instanceof PasswordRequired) {
            const input = window.prompt(`${e.message}\nMot de passe du document :`);
            if (input === null) return;
            password = input;
            continue;
          }
          throw e;
        }
      }
    },
    [notify],
  );

  const openFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy("Ouverture…");
      try {
        const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
        const images = files.filter((f) => f.type.startsWith("image/"));
        if (pdfs.length) {
          const first = new Uint8Array(await pdfs[0].arrayBuffer());
          let bytes: Uint8Array = first;
          if (pdfs.length > 1) {
            const rest = await Promise.all(pdfs.slice(1).map(async (f) => new Uint8Array(await f.arrayBuffer())));
            bytes = (await ops.appendDocuments(first, [], rest)).bytes;
          }
          await loadDocument(bytes, pdfs[0].name);
        } else if (images.length) {
          const list = await Promise.all(
            images.map(async (f) => {
              const url = await normalizeImage(f);
              const bin = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
              return { bytes: bin, type: url.slice(5, url.indexOf(";")) };
            }),
          );
          await loadDocument(await ops.imagesToPdf(list), `${images[0].name.replace(/\.[^.]+$/, "")}.pdf`);
        } else {
          notify("Formats acceptés : PDF, PNG, JPEG, WebP.", true);
        }
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [loadDocument, notify, fail],
  );

  const newBlank = async () => {
    const d = await PDFDocument.create();
    d.addPage([595.28, 841.89]);
    await loadDocument(await d.save(), "nouveau-document.pdf");
  };

  const openSample = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/exemple.pdf`);
      if (!res.ok) throw new Error("Exemple introuvable.");
      await loadDocument(new Uint8Array(await res.arrayBuffer()), "exemple.pdf");
    } catch (e) {
      fail(e);
    }
  };

  // ------------------------------------------------------------- mise à l'échelle

  const computeFit = useCallback(async () => {
    if (!pdf || !viewerRef.current) return;
    // Largeur la plus courante (médiane des 60 premières pages) ; les pages plus
    // larges, comme une page paysage isolée, sont réduites individuellement.
    const widths: number[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
      widths.push((await pdf.getPage(i)).getViewport({ scale: 1 }).width);
    }
    widths.sort((a, b) => a - b);
    const w = widths[Math.floor(widths.length / 2)];
    // Marges des pages + largeur éventuelle d'une barre de défilement verticale.
    const avail = viewerRef.current.clientWidth - (isMobile() ? 18 : 66);
    setFitMax(avail);
    setScale(Math.max(0.25, Math.min(4, avail / w)));
  }, [pdf]);

  useEffect(() => {
    if (fitWidth) computeFit();
  }, [fitWidth, computeFit, panel, propsOpen]);

  useEffect(() => {
    const onResize = () => fitWidth && computeFit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitWidth, computeFit]);

  const zoom = useCallback((factor: number) => {
    setFitWidth(false);
    setScale((s) => Math.max(0.25, Math.min(5, Math.round(s * factor * 100) / 100)));
  }, []);

  // Pincement à deux doigts (Android, iOS, tablettes) et Ctrl+molette.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    let startDist = 0;
    let ratio = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
        ratio = 1;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      ratio = dist(e.touches) / startDist;
      if (pagesRef.current) {
        pagesRef.current.style.transform = `scale(${ratio})`;
        pagesRef.current.style.transformOrigin = `50% ${el.scrollTop + el.clientHeight / 2}px`;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (startDist && e.touches.length < 2) {
        startDist = 0;
        if (pagesRef.current) pagesRef.current.style.transform = "";
        if (Math.abs(ratio - 1) > 0.02) zoom(ratio);
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [zoom, pdf]);

  // Page courante d'après le défilement.
  const onScroll = () => {
    const v = viewerRef.current;
    if (!v) return;
    const mid = v.scrollTop + v.clientHeight / 3;
    let best = 0;
    pageEls.current.forEach((el, i) => {
      if (el.offsetTop <= mid) best = Math.max(best, i);
    });
    setCurrentPage(best);
  };

  const gotoPage = useCallback((i: number) => {
    const el = pageEls.current.get(i);
    const v = viewerRef.current;
    if (el && v) v.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
    if (isMobile()) setPanel(null);
  }, []);

  const registerElement = useCallback((i: number, el: HTMLElement | null) => {
    if (el) pageEls.current.set(i, el);
    else pageEls.current.delete(i);
  }, []);

  // ------------------------------------------------------------- annotations

  const annotationsByPage = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    doc?.annotations.forEach((a) => {
      const l = m.get(a.pageId) ?? [];
      l.push(a);
      m.set(a.pageId, l);
    });
    return m;
  }, [doc?.annotations]);

  const hitsByPage = useMemo(() => {
    const m = new Map<number, Rect[]>();
    hits.forEach((h) => {
      const l = m.get(h.pageIndex) ?? [];
      l.push(h.rect);
      m.set(h.pageIndex, l);
    });
    return m;
  }, [hits]);

  const selected = doc?.annotations.find((a) => a.id === selectedId) ?? null;

  const onCreate = useCallback(
    (a: Annotation) => {
      commit({ annotations: [...(doc?.annotations ?? []), a] });
      if (a.kind === "text" || a.kind === "image") {
        setSelectedId(a.id);
        setTool("select");
        setPropsOpen(true);
      }
    },
    [commit, doc?.annotations],
  );

  const onChange = useCallback(
    (a: Annotation, final: boolean) => {
      if (!doc) return;
      const annotations = doc.annotations.map((x) => (x.id === a.id ? a : x));
      if (final) commit({ annotations });
      else {
        if (!dragBase.current) dragBase.current = snapshot(doc);
        setDoc({ ...doc, annotations });
      }
    },
    [doc, commit],
  );

  const deleteSelected = useCallback(() => {
    if (!doc || !selectedId) return;
    commit({ annotations: doc.annotations.filter((a) => a.id !== selectedId) });
    setSelectedId(null);
  }, [doc, selectedId, commit]);

  const duplicateSelected = () => {
    if (!doc || !selected) return;
    const copy = duplicateAnnotation(selected);
    commit({ annotations: [...doc.annotations, copy] });
    setSelectedId(copy.id);
  };

  const onEditText = useCallback(
    async ({ pageId, run, page }: EditTextRequest) => {
      if (!doc) return;
      const real = realFontName(page, run.fontName);
      const fontKey = matchFont(real);
      try {
        await ensureCssFont(fontKey);
      } catch {
        /* aperçu avec une police de repli */
      }
      const pad = Math.max(0.6, run.fontSize * 0.06);
      const [x1, y1, x2, y2] = run.rect;
      const cover: Annotation = {
        id: newId("annot"),
        kind: "whiteout",
        pageId,
        rect: [x1 - pad, y1 - pad, x2 + pad, y2 + pad],
        color: "#ffffff",
        opacity: 1,
        width: 0,
        fill: true,
      };
      const text: Annotation = {
        id: newId("annot"),
        kind: "text",
        pageId,
        origin: run.baseline,
        text: run.str,
        fontKey,
        fontSize: Math.round(run.fontSize * 10) / 10,
        color: "#000000",
        opacity: 1,
        rotation: run.angle,
      };
      commit({ annotations: [...doc.annotations, cover, text] });
      setSelectedId(text.id);
      setTool("select");
      setPropsOpen(true);
      setFocusText((n) => n + 1);
      const chosen = getFont(fontKey);
      const original = (real ?? "").replace(/^[A-Z]{6}\+/, "");
      const standardEquivalent = /^(helvetica|arial|times|timesnewroman|courier|couriernew)/.test(
        original.replace(/[^a-z]/gi, "").toLowerCase(),
      );
      if (original && chosen.source === "standard" && !standardEquivalent) {
        notify(`Police d'origine « ${original} » absente de cet appareil : remplacée par ${chosen.label}. Importez-la ou autorisez vos polices pour un rendu identique.`);
      }
    },
    [doc, commit, notify],
  );

  const onPlace = useCallback(
    (pageId: string, at: Point) => {
      if (!pending || !doc) return;
      const width = pending.signature ? 160 : Math.min(240, pending.w * 0.75);
      const height = (width * pending.h) / pending.w;
      const a: Annotation = {
        id: newId("annot"),
        kind: "image",
        pageId,
        rect: [at[0] - width / 2, at[1] - height / 2, at[0] + width / 2, at[1] + height / 2],
        dataUrl: pending.dataUrl,
        color: "#000000",
        opacity: 1,
      };
      commit({ annotations: [...doc.annotations, a] });
      setPending(null);
      setTool("select");
      setSelectedId(a.id);
    },
    [pending, doc, commit],
  );

  const startImage = async (dataUrl: string, signature: boolean) => {
    const { w, h } = await imageSize(dataUrl);
    setPending({ dataUrl, w, h, signature });
    setTool("image");
    setSelectedId(null);
    notify("Touchez la page à l'endroit où placer l'image.");
  };

  // ------------------------------------------------------------- pages

  const pageOp = async (label: string, run: (d: DocState) => Promise<ops.PagesResult>, fixAnnotations?: (d: DocState, r: ops.PagesResult) => Annotation[]) => {
    if (!doc) return;
    if (!doc.rewritable) return notify("Les pages de ce PDF protégé ne peuvent pas être réorganisées.", true);
    setBusy(label);
    try {
      const r = await run(doc);
      const keep = new Set(r.pageIds);
      const annotations = fixAnnotations ? fixAnnotations(doc, r) : doc.annotations.filter((a) => keep.has(a.pageId));
      commit({ bytes: r.bytes, pageIds: r.pageIds, annotations });
      setSelectedPages((s) => new Set([...s].filter((id) => keep.has(id))));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const targetPages = () => (selectedPages.size ? selectedPages : new Set(doc ? [doc.pageIds[currentPage]] : []));

  // ------------------------------------------------------------- export

  const buildPdf = async (): Promise<Uint8Array> => {
    if (!doc || !pdf) throw new Error("Aucun document ouvert.");
    if (doc.rewritable) return exportPdf(doc.bytes, doc.pageIds, doc.annotations);
    return rasterExport(pdf, doc.pageIds, doc.annotations, (n, t) => setBusy(`Préparation ${n}/${t}…`));
  };

  const withExport = async (label: string, action: (bytes: Uint8Array) => Promise<void> | void) => {
    if (locked) return notify(locked, true);
    setBusy(label);
    try {
      await action(await buildPdf());
    } catch (e) {
      if ((e as Error).name !== "AbortError") fail(e);
    } finally {
      setBusy(null);
    }
  };

  const save = () => withExport("Enregistrement…", (b) => download(b, doc!.name.replace(/\.pdf$/i, "") + ".pdf"));

  const share = () =>
    withExport("Préparation du partage…", async (b) => {
      const file = new File([b as BlobPart], doc!.name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: doc!.name });
      else download(b, doc!.name);
    });

  const print = () =>
    withExport("Préparation de l'impression…", (b) => {
      const url = URL.createObjectURL(new Blob([b as BlobPart], { type: "application/pdf" }));
      if (isMobile()) {
        window.open(url, "_blank");
        return;
      }
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      frame.src = url;
      frame.onload = () => {
        frame.contentWindow?.print();
        setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 60_000);
      };
      document.body.append(frame);
    });

  const extract = () =>
    withExport("Extraction…", async (b) => {
      const indices = doc!.pageIds.map((id, i) => (selectedPages.has(id) ? i : -1)).filter((i) => i >= 0);
      download(await ops.extractPages(b, indices), doc!.name.replace(/\.pdf$/i, "") + "-extrait.pdf");
    });

  const applyForm = async (values: FormValues, fontKey: string | undefined) => {
    if (!doc) return;
    setBusy("Remplissage du formulaire…");
    try {
      commit({ bytes: await fillForm(doc.bytes, values, fontKey) });
      notify("Formulaire mis à jour.");
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------- clavier

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable]");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (doc) save();
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openInput.current?.click();
      } else if (mod && e.key.toLowerCase() === "f" && doc) {
        e.preventDefault();
        setPanel("search");
      } else if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoom(1.2);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoom(1 / 1.2);
      } else if (typing || mod || e.altKey) {
        return;
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setTool("select");
        setSelectedId(null);
        setPending(null);
      } else {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t && doc && !locked) setTool(t.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------- glisser-déposer & partage Android

  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragOver(e.type === "dragover");
      }
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragOver(false);
      openFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("dragleave", prevent);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("dragleave", prevent);
      window.removeEventListener("drop", drop);
    };
  }, [openFiles]);

  // Ouverture depuis « Ouvrir avec » (PWA installée sur ordinateur).
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async ({ files }) => {
      if (files?.length) openFiles(await Promise.all(files.map((h) => h.getFile())));
    });
  }, [openFiles]);

  const editable = !!doc && !locked;

  // ------------------------------------------------------------- rendu

  const filePickers = (
    <>
      <input
        ref={openInput}
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          openFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={mergeInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          const others = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
          pageOp("Fusion…", (d) => ops.appendDocuments(d.bytes, d.pageIds, others));
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) startImage(await normalizeImage(f), false).catch(fail);
        }}
      />
    </>
  );

  if (!doc) {
    return (
      <div className={`welcome ${dragOver ? "drag" : ""}`}>
        {filePickers}
        <div className="welcome-card">
          <div className="logo">
            <Icon name="pages" size={40} />
          </div>
          <h1>Paperasse</h1>
          <p>Lisez, annotez, modifiez, signez et réorganisez vos PDF. Tout reste sur votre appareil : rien n'est envoyé sur internet.</p>
          <button className="primary big" onClick={() => openInput.current?.click()}>
            <Icon name="open" /> Ouvrir un fichier
          </button>
          <div className="welcome-actions">
            <button onClick={newBlank}>Nouveau PDF vierge</button>
            <button onClick={() => openInput.current?.click()}>Images → PDF</button>
          </div>
          <button className="link" onClick={openSample}>
            Essayer avec un exemple
          </button>
          <p className="hint">ou glissez-déposez vos fichiers ici</p>
        </div>
        {busy && <div className="busy">{busy}</div>}
        {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.msg}</div>}
      </div>
    );
  }

  return (
    <div className={`app ${panel ? "with-panel" : ""} ${propsOpen ? "with-props" : ""} ${dragOver ? "drag" : ""}`}>
      {filePickers}
      <header className="topbar">
        <button className="icon-btn" title="Panneau des pages" onClick={() => setPanel((p) => (p ? null : "pages"))}>
          <Icon name="menu" />
        </button>
        <div className="doc-name" title={doc.name}>
          {doc.name}
        </div>
        <div className="top-actions">
          <button className="open-btn" title="Ouvrir un fichier PDF ou une image (Ctrl+O)" onClick={() => openInput.current?.click()}>
            <Icon name="open" />
            <span className="desktop-only">Ouvrir un fichier</span>
            <span className="mobile-only">Ouvrir</span>
          </button>
          <button className="icon-btn" title="Annuler (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" title="Rétablir (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>
            <Icon name="redo" />
          </button>
          <span className="sep desktop-only" />
          <button className="icon-btn desktop-only" title="Zoom arrière" onClick={() => zoom(1 / 1.2)}>
            <Icon name="zoomOut" />
          </button>
          <button className="zoom-label desktop-only" title="Ajuster à la largeur" onClick={() => setFitWidth(true)}>
            {Math.round(scale * 100)} %
          </button>
          <button className="icon-btn desktop-only" title="Zoom avant" onClick={() => zoom(1.2)}>
            <Icon name="zoomIn" />
          </button>
          <span className="sep desktop-only" />
          <button className="icon-btn" title="Rechercher (Ctrl+F)" onClick={() => setPanel((p) => (p === "search" ? null : "search"))}>
            <Icon name="search" />
          </button>
          <button className="icon-btn desktop-only" title="Imprimer" onClick={print}>
            <Icon name="print" />
          </button>
          <button className="icon-btn" title="Partager" onClick={share}>
            <Icon name="share" />
          </button>
          <button className="primary save-btn" title="Enregistrer (Ctrl+S)" onClick={save}>
            <Icon name="save" /> <span className="desktop-only">Enregistrer</span>
          </button>
        </div>
      </header>

      {locked && <div className="banner">{locked}</div>}

      <nav className="toolbar" aria-label="Outils">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool ${tool === t.id ? "active" : ""}`}
            title={`${t.label} (${t.key.toUpperCase()})`}
            disabled={!editable && t.id !== "select"}
            onClick={() => {
              setTool(t.id);
              setPending(null);
              if (t.id !== "select") setSelectedId(null);
            }}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
        <button className={`tool ${tool === "image" && pending?.signature ? "active" : ""}`} disabled={!editable} onClick={() => setSigning(true)} title="Signer">
          <Icon name="sign" />
          <span>Signer</span>
        </button>
        <button className={`tool ${tool === "image" && pending && !pending.signature ? "active" : ""}`} disabled={!editable} onClick={() => imageInput.current?.click()} title="Image">
          <Icon name="image" />
          <span>Image</span>
        </button>
        <span className="toolbar-sep" />
        <button className={`tool ${propsOpen ? "active" : ""}`} onClick={() => setPropsOpen((o) => !o)} title="Réglages">
          <Icon name="props" />
          <span>Réglages</span>
        </button>
      </nav>

      {panel && <div className="backdrop mobile-only" onClick={() => setPanel(null)} />}
      <aside className={`side-panel ${panel ? "open" : ""}`}>
        <div className="tabs" role="tablist">
          <button className={panel === "pages" ? "active" : ""} onClick={() => setPanel("pages")}>
            <Icon name="pages" size={16} /> Pages
          </button>
          <button className={panel === "search" ? "active" : ""} onClick={() => setPanel("search")}>
            <Icon name="search" size={16} /> Recherche
          </button>
          <button className={panel === "forms" ? "active" : ""} onClick={() => setPanel("forms")}>
            <Icon name="form" size={16} /> Formulaire
          </button>
          <button className="icon-btn close" onClick={() => setPanel(null)} title="Fermer">
            <Icon name="close" size={18} />
          </button>
        </div>
        {pdf && panel === "pages" && (
          <Thumbnails
            pdf={pdf}
            pageIds={doc.pageIds}
            current={currentPage}
            selected={selectedPages}
            editable={editable && doc.rewritable}
            onToggle={(id) =>
              setSelectedPages((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onSelectAll={() => setSelectedPages((s) => (s.size === doc.pageIds.length ? new Set() : new Set(doc.pageIds)))}
            onGoto={gotoPage}
            onRotate={(delta) => pageOp("Rotation…", (d) => ops.rotatePages(d.bytes, d.pageIds, targetPages(), delta))}
            onDelete={() => {
              if (window.confirm(`Supprimer ${selectedPages.size} page(s) ?`)) {
                pageOp("Suppression…", (d) => ops.deletePages(d.bytes, d.pageIds, selectedPages));
              }
            }}
            onDuplicate={() => {
              const id = [...selectedPages][0];
              pageOp(
                "Duplication…",
                (d) => ops.duplicatePage(d.bytes, d.pageIds, d.pageIds.indexOf(id)),
                (d, r) => {
                  const newPageId = r.pageIds[d.pageIds.indexOf(id) + 1];
                  const copies = d.annotations.filter((a) => a.pageId === id).map((a) => ({ ...a, id: newId("annot"), pageId: newPageId }));
                  return [...d.annotations, ...copies];
                },
              );
            }}
            onMove={(dir) => {
              const id = [...selectedPages][0];
              const from = doc.pageIds.indexOf(id);
              const to = from + dir;
              if (to < 0 || to >= doc.pageIds.length) return;
              pageOp("Déplacement…", (d) => ops.movePage(d.bytes, d.pageIds, from, to));
            }}
            onInsertBlank={() => pageOp("Insertion…", (d) => ops.insertBlankPage(d.bytes, d.pageIds, currentPage))}
            onExtract={extract}
            onMerge={() => mergeInput.current?.click()}
          />
        )}
        {pdf && panel === "search" && (
          <SearchPanel
            pdf={pdf}
            active={activeHit}
            onResults={(h) => {
              setHits(h);
              setActiveHit(h.length ? 0 : -1);
            }}
            onGoto={(_, i) => setActiveHit(i)}
          />
        )}
        {panel === "forms" && <FormsPanel bytes={doc.bytes} editable={editable && doc.rewritable} onApply={applyForm} onError={(m) => notify(m, true)} />}
      </aside>

      <main
        ref={viewerRef}
        className={`viewer tool-${tool}`}
        onScroll={onScroll}
        onPointerDown={(e) => {
          if (tool === "select" && !(e.target as Element).closest("[data-annot], .handle")) setSelectedId(null);
        }}
      >
        <div ref={pagesRef} className="pages">
          {pdf &&
            doc.pageIds.slice(0, pdf.numPages).map((id, i) => (
              <PageView
                key={id}
                pdf={pdf}
                index={i}
                pageId={id}
                scale={scale}
                maxWidth={fitWidth ? fitMax : null}
                tool={editable ? tool : "select"}
                style={style}
                annotations={annotationsByPage.get(id) ?? EMPTY}
                selectedId={selectedId}
                hits={hitsByPage.get(i) ?? EMPTY_RECTS}
                activeHit={hits[activeHit]?.pageIndex === i ? hits[activeHit].rect : null}
                onSelect={setSelectedId}
                onCreate={onCreate}
                onChange={onChange}
                onEditText={onEditText}
                onPlace={onPlace}
                onFocusText={() => {
                  setPropsOpen(true);
                  setFocusText((n) => n + 1);
                }}
                registerElement={registerElement}
              />
            ))}
        </div>
        {pdf && (
          <div className="page-indicator">
            {currentPage + 1} / {pdf.numPages}
          </div>
        )}
        <div className="zoom-fab mobile-only">
          <button onClick={() => zoom(1 / 1.25)} aria-label="Zoom arrière">
            <Icon name="zoomOut" />
          </button>
          <button onClick={() => setFitWidth(true)} aria-label="Ajuster">
            <Icon name="fit" />
          </button>
          <button onClick={() => zoom(1.25)} aria-label="Zoom avant">
            <Icon name="zoomIn" />
          </button>
        </div>
      </main>

      <aside className={`props ${propsOpen ? "open" : ""}`}>
        <button className="icon-btn close mobile-only" onClick={() => setPropsOpen(false)} title="Fermer">
          <Icon name="close" size={18} />
        </button>
        <PropertiesPanel
          tool={tool}
          style={style}
          selected={selected}
          focusText={focusText}
          onStyle={(p) => setStyle((s) => ({ ...s, ...p }))}
          onUpdate={onChange}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onError={(m) => notify(m, true)}
        />
      </aside>

      {signing && (
        <SignaturePad
          onCancel={() => setSigning(false)}
          onDone={(url) => {
            setSigning(false);
            startImage(url, true).catch(fail);
          }}
        />
      )}
      {busy && <div className="busy">{busy}</div>}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const EMPTY: Annotation[] = [];
const EMPTY_RECTS: Rect[] = [];
