import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { fontInfo, openPdf, PasswordRequired, pdfjs, type PDFDocumentProxy } from "./lib/pdfjs";
import type { Annotation, DocState, Point, Rect, ShapeAnnotation, TextAnnotation, Tool } from "./lib/types";
import { newId } from "./lib/types";
import * as ops from "./lib/pageOps";
import { exportPdf } from "./lib/exportPdf";
import { rasterExport } from "./lib/rasterExport";
import { fillForm, type FormValues } from "./lib/forms";
import {
  DEFAULT_FONT_KEY,
  ensureCssFont,
  fontBytes,
  getFont,
  loadLibrary,
  matchFont,
  normalizeFontName,
  parseFontName,
  importedFonts,
  registerFontBytes,
} from "./lib/fonts";
import { clearDraft, draftInfo, formatSavedAt, loadDraft, saveDraft, type DraftInfo } from "./lib/drafts";
import { facesFor, restoreFaces } from "./lib/embeddedFontBuilder";
import { duplicateAnnotation } from "./lib/annotations";
import { buildEmbeddedFont } from "./lib/embeddedFontBuilder";
import { stylesFromFonts } from "./lib/textBlocks";
import { documentFontFor, restoreDocumentFont } from "./lib/documentFonts";
import { fileFonts as listFileFonts, type FileFont } from "./lib/fileFonts";
import { addPickedColor, loadPickedColors, toHex } from "./lib/pickedColors";
import type { SearchHit } from "./lib/text";
import { PageView, type EditTextRequest, type ToolStyle } from "./components/PageView";
import { Thumbnails } from "./components/Thumbnails";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { SearchPanel } from "./components/SearchPanel";
import { FormsPanel } from "./components/FormsPanel";
import { SignDialog } from "./components/SignDialog";
import { boxAt, cornerPosition, freeSpot, layoutParts, obstaclesOn, partHeight, partWidth, type PagePosition, type PlacePart } from "./lib/signatures";
import { DocumentTools, type DocTab } from "./components/DocumentTools";
import { MobileBar } from "./components/MobileBar";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { OcrDialog } from "./components/OcrDialog";
import { pageHasText } from "./lib/ocr";
import { addInvisibleText } from "./lib/ocrLayer";
import { suggestFieldName } from "./lib/formFields";
import type { ShapeId } from "./lib/shapes";
import { Icon } from "./components/Icon";
import { FileNameDialog } from "./components/FileNameDialog";
import { LanguagePicker } from "./components/LanguagePicker";
import { initialLanguage } from "./lib/language";
import { msg, setLocale, t, tn, useLocale, type Locale } from "./i18n";
import { buildFileName, isoDate, loadNamePrefs } from "./lib/fileName";

/** Écran de numérisation chargé à la demande (caméra, détection, nettoyage). */
const Scanner = lazy(() => import("./components/Scanner"));

type Snapshot = Pick<DocState, "bytes" | "pageIds" | "annotations">;
type Panel = "pages" | "search" | "forms";

/** Outils regroupés sous le bouton « Dessin » (choix dans le panneau de droite). */
export const DRAW_TOOLS: Tool[] = ["ink", "highlight", "line", "arrow"];
/** Outils regroupés sous le bouton « Formes ». */
export const SHAPE_TOOLS: Tool[] = ["shape", "rect", "ellipse"];

/** Boutons de la barre d'outils ; `tools` = outils couverts par un bouton groupé. */
const BUTTONS: { id: string; label: string; icon: string; key?: string; tools: Tool[] }[] = [
  { id: "select", label: msg("Sélection"), icon: "select", key: "V", tools: ["select"] },
  { id: "editText", label: msg("Modifier le texte"), icon: "editText", key: "E", tools: ["editText"] },
  { id: "text", label: msg("Ajouter du texte"), icon: "text", key: "T", tools: ["text"] },
  { id: "draw", label: msg("Dessin"), icon: "ink", key: "D", tools: DRAW_TOOLS },
  { id: "shapes", label: msg("Formes"), icon: "shapes", key: "R", tools: SHAPE_TOOLS },
  { id: "eraser", label: msg("Gomme"), icon: "eraser", key: "G", tools: ["eraser"] },
  { id: "whiteout", label: msg("Cache blanc"), icon: "whiteout", key: "W", tools: ["whiteout"] },
  { id: "stamp", label: msg("Tampon"), icon: "stamp", key: "P", tools: ["stamp"] },
  { id: "field", label: msg("Champ de formulaire"), icon: "form", key: "F", tools: ["field"] },
];

/** Raccourcis clavier : outil et éventuel réglage associé. */
const KEYS: Record<string, { tool: Tool; shape?: ShapeId; doubleArrow?: boolean }> = {
  v: { tool: "select" },
  e: { tool: "editText" },
  t: { tool: "text" },
  d: { tool: "ink" },
  h: { tool: "highlight" },
  l: { tool: "line" },
  a: { tool: "arrow", doubleArrow: false },
  r: { tool: "shape", shape: "rect" },
  o: { tool: "shape", shape: "ellipse" },
  w: { tool: "whiteout" },
  g: { tool: "eraser" },
  p: { tool: "stamp" },
  f: { tool: "field" },
};

type PendingKind = "image" | "signature" | "stamp";

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
  useLocale();
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
  /** Dernier outil de dessin utilisé (repris par le bouton « Dessin »). */
  const [lastDraw, setLastDraw] = useState<Tool>("ink");
  useEffect(() => {
    if (DRAW_TOOLS.includes(tool)) setLastDraw(tool);
  }, [tool]);
  const [style, setStyle] = useState<ToolStyle>({
    color: "#e5484d",
    width: 2,
    opacity: 1,
    fill: false,
    fontKey: DEFAULT_FONT_KEY,
    fontSize: 14,
    underline: false,
    strike: false,
    align: "left",
    highlight: null,
    fieldType: "text",
    shape: "rect",
    doubleArrow: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Panneau de gauche : ouvert par défaut sur ordinateur (pages), repliable par une flèche (choix retenu).
  const [panel, setPanel] = useState<Panel | null>(() => {
    if (isMobile()) return null;
    try {
      const saved = localStorage.getItem("paperasse-panneau");
      return saved === "replié" ? null : ((saved as Panel | null) ?? "pages");
    } catch {
      return "pages";
    }
  });
  const lastPanel = useRef<Panel>("pages");
  useEffect(() => {
    if (panel) lastPanel.current = panel;
    if (isMobile()) return;
    try {
      localStorage.setItem("paperasse-panneau", panel ?? "replié");
    } catch {
      /* navigation privée */
    }
  }, [panel]);
  const [propsOpen, setPropsOpen] = useState(() => !isMobile());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  /** Image, tampon ou groupe (signature, mention…) prêt à être posé d'un appui sur la page. */
  const [pending, setPending] = useState<{ dataUrl: string; w: number; h: number; kind: PendingKind; group?: PlacePart[] } | null>(null);
  const [signing, setSigning] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [docTools, setDocTools] = useState<DocTab | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  /** Langue de l'utilisateur (détectée au démarrage, modifiable par le drapeau) : langue d'OCR par défaut. */
  const [language, setLanguage] = useState(initialLanguage);
  useEffect(() => {
    setLocale(language.language.code as Locale).catch(() => undefined);
  }, [language]);
  // Le scanner est préchargé en arrière-plan : le service worker le garde pour un usage hors ligne.
  useEffect(() => {
    const t = window.setTimeout(() => void import("./components/Scanner").catch(() => undefined), 5000);
    return () => window.clearTimeout(t);
  }, []);
  /** Nom demandé avant d'enregistrer ou de partager un document numérisé. */
  const [askName, setAskName] = useState<"save" | "share" | null>(null);
  /** Document qui semble être un scan (pas de texte) : l'OCR est proposé. */
  const [scanned, setScanned] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [locked, setLocked] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const viewerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLElement>());
  const openInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((msg: string, error = false, duration?: number) => {
    setToast({ msg, error });
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), duration ?? (error ? 7000 : 3500));
  }, []);
  const fail = useCallback((e: unknown) => notify(e instanceof Error ? e.message : String(e), true), [notify]);

  // ------------------------------------------------------------- polices du fichier
  const [fileFonts, setFileFonts] = useState<FileFont[]>([]);
  useEffect(() => {
    let alive = true;
    setFileFonts([]);
    if (!doc?.bytes) return;
    // Bibliothèque chargée d'abord : chaque police du fichier trouve sa meilleure correspondance.
    loadLibrary(import.meta.env.BASE_URL)
      .then(() => listFileFonts(doc.bytes))
      .then((list) => {
        if (!alive) return;
        setFileFonts(list);
        // Préchargement en arrière-plan : les polices du fichier sont prêtes (et gardées en
        // cache sur l'appareil) avant d'en avoir besoin pour modifier ou ajouter du texte.
        for (const f of list) fontBytes(f.key).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Recalcul seulement quand un autre document est ouvert (pas à chaque modification).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.name, pdf]);

  // ------------------------------------------------------------- pipette
  const [pickedColors, setPickedColors] = useState<string[]>(() => loadPickedColors());
  const [picking, setPicking] = useState(false);
  const pickResolve = useRef<((hex: string | null) => void) | null>(null);
  /** Termine la pipette : mémorise la couleur (7 dernières) et la rend au panneau. */
  const finishPick = useCallback((hex: string | null) => {
    setPicking(false);
    const resolve = pickResolve.current;
    pickResolve.current = null;
    if (hex) setPickedColors((l) => addPickedColor(l, hex));
    resolve?.(hex);
  }, []);
  const pickColor = useCallback(async (): Promise<string | null> => {
    // Pipette du navigateur (Chrome, Edge sur ordinateur) : tout l'écran, ajouts compris.
    const Native = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (Native) {
      try {
        const hex = toHex((await new Native().open()).sRGBHex);
        if (hex) setPickedColors((l) => addPickedColor(l, hex));
        return hex;
      } catch {
        return null; // Échap
      }
    }
    // Ailleurs (Firefox, Safari, Android) : le prochain appui sur la page donne sa couleur.
    pickResolve.current?.(null);
    setPicking(true);
    notify(t("Pipette : touchez la page pour copier sa couleur (Échap pour annuler)."), false, 6000);
    return new Promise((resolve) => {
      pickResolve.current = resolve;
    });
  }, [notify]);

  // ------------------------------------------------------------- historique

  const snapshot = (d: DocState): Snapshot => ({ bytes: d.bytes, pageIds: d.pageIds, annotations: d.annotations });

  /**
   * Enregistre une modification dans l'historique. Passer une fonction calcule
   * la modification à partir de l'état le plus récent : indispensable pour les
   * opérations asynchrones (deux « Modifier le texte » rapides ne s'écrasent pas).
   */
  const lastCommit = useRef<object | null>(null);
  /** Le prochain enregistrement prolonge l'étape d'historique précédente (édition de texte). */
  const mergeNext = useRef(false);
  const commit = useCallback((next: Partial<Snapshot> | ((d: DocState) => Partial<Snapshot>)) => {
    const token = {};
    const merge = mergeNext.current;
    mergeNext.current = false;
    setDoc((d) => {
      if (!d) return d;
      // L'historique n'est mis à jour qu'une fois par enregistrement, même si React
      // rappelle cette fonction (mode strict en développement).
      if (lastCommit.current !== token) {
        lastCommit.current = token;
        if (!merge) {
          past.current.push(dragBase.current ?? snapshot(d));
          if (past.current.length > 100) past.current.shift();
        }
        dragBase.current = null;
        future.current = [];
      }
      return { ...d, ...(typeof next === "function" ? next(d) : next) };
    });
    forceHistory((n) => n + 1);
  }, []);

  const addAnnotations = useCallback(
    (...added: Annotation[]) => commit((d) => ({ annotations: [...d.annotations, ...added] })),
    [commit],
  );

  /**
   * Déplace une étape d'une pile d'historique à l'autre. Le résultat est mémorisé
   * par appel : si React rappelle la fonction de mise à jour (mode strict), une
   * seule étape est déplacée.
   */
  const lastStep = useRef<{ token: object; result: Snapshot | null } | null>(null);
  const step = useCallback((from: React.MutableRefObject<Snapshot[]>, to: React.MutableRefObject<Snapshot[]>) => {
    const token = {};
    setDoc((d) => {
      if (!d) return d;
      if (lastStep.current?.token !== token) {
        const target = from.current.pop() ?? null;
        if (target) to.current.push(snapshot(d));
        lastStep.current = { token, result: target };
      }
      const target = lastStep.current.result;
      return target ? { ...d, ...target } : d;
    });
    setSelectedId(null);
    forceHistory((n) => n + 1);
  }, []);

  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

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
            ? t("L'auteur de ce PDF n'autorise pas sa modification : lecture, recherche et copie restent disponibles selon ses permissions.")
            : null,
        );
      })
      .catch(fail);
    return () => {
      alive = false;
    };
  }, [doc, fail]);

  const loadDocument = useCallback(
    async (bytes: Uint8Array, name: string, extra: { scan?: boolean } = {}) => {
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
          setDoc({ name, bytes, pageIds: ops.freshPageIds(count), annotations: [], rewritable, password, ...(extra.scan ? { scan: true, fileBase: "Scan", fileDate: isoDate() } : {}) });
          if (!rewritable) {
            notify(t("PDF protégé ou atypique : l'annotation reste possible, l'export se fera page par page en image."));
          }
          return;
        } catch (e) {
          if (e instanceof PasswordRequired) {
            const input = window.prompt(`${e.message}\n${t("Mot de passe du document :")}`);
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
      setBusy(t("Ouverture…"));
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
          notify(t("Formats acceptés : PDF, PNG, JPEG, WebP."), true);
        }
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [loadDocument, notify, fail],
  );

  // ------------------------------------------------------------- sauvegarde automatique

  const [draft, setDraft] = useState<DraftInfo | null>(null);

  // Travail en cours proposé à la reprise sur l'écran d'accueil.
  useEffect(() => {
    if (doc) return;
    loadDraft()
      .then((d) => setDraft(d ? draftInfo(d) : null))
      .catch(() => setDraft(null));
  }, [doc]);

  // Enregistrement une seconde après chaque modification (sauf PDF protégé par mot de passe).
  useEffect(() => {
    if (!doc || doc.password) return;
    const timer = window.setTimeout(async () => {
      try {
        const families = doc.annotations.flatMap((a) =>
          a.kind === "text" && a.embedded ? [a.embedded.cssFamily.replace(/"/g, "")] : [],
        );
        await saveDraft({
          name: doc.name,
          bytes: doc.bytes,
          pageIds: doc.pageIds,
          annotations: doc.annotations,
          rewritable: doc.rewritable,
          scan: doc.scan,
          fileBase: doc.fileBase,
          fileDate: doc.fileDate,
          savedAt: Date.now(),
          faces: facesFor(families),
          importedFonts: await importedFonts(),
        });
      } catch {
        /* stockage plein ou indisponible (navigation privée) : on continue sans sauvegarde */
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [doc]);

  const resumeDraft = async () => {
    setBusy(t("Reprise du travail en cours…"));
    try {
      const d = await loadDraft();
      if (!d) return setDraft(null);
      await restoreFaces(d.faces ?? {});
      for (const [name, buffer] of Object.entries(d.importedFonts ?? {})) registerFontBytes(name, buffer);
      for (const a of d.annotations) if (a.kind === "text") restoreDocumentFont(a.fontKey);
      past.current = [];
      future.current = [];
      bytesRef.current = null;
      setSelectedId(null);
      setSelectedPages(new Set());
      setHits([]);
      setCurrentPage(0);
      setFitWidth(true);
      setDoc({ name: d.name, bytes: d.bytes, pageIds: d.pageIds, annotations: d.annotations, rewritable: d.rewritable, ...(d.scan ? { scan: true } : {}), ...(d.fileBase !== undefined ? { fileBase: d.fileBase, fileDate: d.fileDate ?? null } : {}) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const discardDraft = () => {
    clearDraft().catch(() => undefined);
    setDraft(null);
  };

  const newBlank = async () => {
    const d = await PDFDocument.create();
    d.addPage([595.28, 841.89]);
    await loadDocument(await d.save(), "nouveau-document.pdf");
  };

  const openSample = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/exemple.pdf`);
      if (!res.ok) throw new Error(t("Exemple introuvable."));
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

  /**
   * Texte du PDF ouvert avec « Modifier le texte » mais pas encore changé : il est
   * affiché et éditable, sans entrer dans le document ni dans l'historique. Il
   * n'est enregistré qu'au premier vrai changement (texte, police, taille…).
   */
  type PendingEdit = { covers: Annotation[]; text: TextAnnotation; snapshot: string };
  const [pendingEdit, setPendingEditState] = useState<PendingEdit | null>(null);
  const pendingRef = useRef<PendingEdit | null>(null);
  const setPendingEdit = useCallback((p: PendingEdit | null) => {
    pendingRef.current = p;
    setPendingEditState(p);
  }, []);

  // Quitter un texte ouvert sans l'avoir changé ne laisse aucune trace.
  useEffect(() => {
    const p = pendingRef.current;
    if (p && selectedId !== p.text.id) setPendingEdit(null);
    if (!selectedId) mergeNext.current = false;
  }, [selectedId, setPendingEdit]);

  const annotationsByPage = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    const all = pendingEdit ? [...(doc?.annotations ?? []), ...pendingEdit.covers, pendingEdit.text] : (doc?.annotations ?? []);
    all.forEach((a) => {
      const l = m.get(a.pageId) ?? [];
      l.push(a);
      m.set(a.pageId, l);
    });
    return m;
  }, [doc?.annotations, pendingEdit]);

  const hitsByPage = useMemo(() => {
    const m = new Map<number, Rect[]>();
    hits.forEach((h) => {
      const l = m.get(h.pageIndex) ?? [];
      l.push(h.rect);
      m.set(h.pageIndex, l);
    });
    return m;
  }, [hits]);

  const selected =
    (pendingEdit?.text.id === selectedId ? pendingEdit.text : doc?.annotations.find((a) => a.id === selectedId)) ?? null;

  const onCreate = useCallback(
    (a: Annotation) => {
      if (a.kind === "field" && !a.name) {
        // Nom unique calculé sur l'état le plus récent (texte_1, case_2…).
        const id = a.id;
        commit((d) => {
          const taken = d.annotations.flatMap((x) => (x.kind === "field" ? [x.name] : []));
          return { annotations: [...d.annotations, { ...a, name: suggestFieldName(a.fieldType, taken) }] };
        });
        setSelectedId(id);
        setPropsOpen(true);
        return;
      }
      addAnnotations(a);
      // Le texte ajouté s'édite tout de suite sur la page ; l'outil reste actif
      // pour enchaîner les ajouts (on en sort avec un autre outil ou Échap).
      if (a.kind === "text") {
        setSelectedId(a.id);
        if (!isMobile()) setPropsOpen(true);
      }
      // Forme, trait ou flèche qu'on vient de dessiner : sélectionnée tout de suite avec ses
      // poignées (taille, rotation, extrémités), comme dans les logiciels de dessin.
      if (a.kind === "shape" || a.kind === "rect" || a.kind === "ellipse" || a.kind === "line") {
        setTool("select");
        setSelectedId(a.id);
      }
    },
    [addAnnotations, commit],
  );

  const onChange = useCallback(
    (a: Annotation, final: boolean) => {
      if (!doc) return;
      const p = pendingRef.current;
      if (p && a.id === p.text.id) {
        if (JSON.stringify(a) === p.snapshot) {
          setPendingEdit({ ...p, text: a as TextAnnotation });
          return;
        }
        // Premier vrai changement : le texte modifié et son cache entrent dans le
        // document, en une seule étape d'annulation avec la suite de la saisie.
        setPendingEdit(null);
        addAnnotations(...p.covers, a);
        if (!final) mergeNext.current = true;
        return;
      }
      const annotations = doc.annotations.map((x) => (x.id === a.id ? a : x));
      if (final) commit({ annotations });
      else {
        if (!dragBase.current) dragBase.current = snapshot(doc);
        setDoc({ ...doc, annotations });
      }
    },
    [doc, commit, addAnnotations, setPendingEdit],
  );

  /** Gomme : retire les éléments touchés, en une seule étape d'annulation. */
  const onErase = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      if (pendingRef.current && gone.has(pendingRef.current.text.id)) setPendingEdit(null);
      if (selectedId && gone.has(selectedId)) setSelectedId(null);
      const committed = (doc?.annotations ?? []).some((a) => gone.has(a.id));
      if (committed) commit((d) => ({ annotations: d.annotations.filter((a) => !gone.has(a.id)) }));
    },
    [doc?.annotations, selectedId, commit, setPendingEdit],
  );

  const deleteSelected = useCallback(() => {
    if (!doc || !selectedId) return;
    if (pendingRef.current?.text.id === selectedId) {
      // Texte seulement ouvert : rien à retirer du document.
      setPendingEdit(null);
      setSelectedId(null);
      return;
    }
    commit({ annotations: doc.annotations.filter((a) => a.id !== selectedId) });
    setSelectedId(null);
  }, [doc, selectedId, commit, setPendingEdit]);

  const duplicateSelected = () => {
    if (!doc || !selected) return;
    const copy = duplicateAnnotation(selected);
    addAnnotations(copy);
    setSelectedId(copy.id);
  };

  const onEditText = useCallback(
    async ({ pageId, run, page, color, background, block }: EditTextRequest) => {
      if (!doc) return;
      await loadLibrary(import.meta.env.BASE_URL);
      const info = fontInfo(page, run.fontName);
      const real = info.name;
      // Police complète du document quand une source autorisée existe (Marianne pour les
      // documents de l'État, polices libres à la graisse exacte, DejaVu) : les lettres absentes
      // de la police incorporée sont alors les vraies. Sinon, la police la plus proche.
      let fontKey = documentFontFor(real, info) ?? matchFont(real, undefined, info);
      // Police incorporée dans le PDF, réutilisée telle quelle quand c'est possible.
      const embedded = doc.rewritable ? await buildEmbeddedFont(doc.bytes, page, run.fontName) : null;
      try {
        await ensureCssFont(fontKey);
      } catch {
        // Police du document indisponible (hors ligne, graisse absente de la source) : la plus proche.
        const closest = matchFont(real, undefined, info);
        if (closest !== fontKey) {
          fontKey = closest;
          try {
            await ensureCssFont(fontKey);
          } catch {
            /* aperçu avec une police de repli */
          }
        }
      }
      const textId = newId("annot");
      // Un cache par ligne d'origine : chaque ligne sera réellement retirée du fichier à l'enregistrement.
      const coverFor = (rect: [number, number, number, number], origin: [number, number], angle: number, width: number, fontSize: number): ShapeAnnotation => {
        const pad = Math.max(0.6, fontSize * 0.06);
        return {
          id: newId("annot"),
          kind: "whiteout",
          pageId,
          rect: [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad],
          // Même couleur que le fond autour du texte (fond coloré d'un tableau, d'un bandeau…).
          color: background ?? "#ffffff",
          opacity: 1,
          width: 0,
          fill: true,
          removeText: { origin, angle, width, fontSize },
          owner: textId,
        };
      };
      // Bloc (titre, paragraphe) : toutes ses lignes deviennent un seul texte remis en page.
      const asBlock = block && (block.lines.length > 1 || block.lines[0].pieces.length > 1) ? block : null;
      // Styles mélangés du bloc (gras, lien, symbole) : chaque autre police est préparée comme la principale.
      const mixed = asBlock ? stylesFromFonts(asBlock.fonts, run.fontName) : null;
      const extraFonts = mixed
        ? await Promise.all(
            mixed.names.map(async (name) => {
              const other = fontInfo(page, name);
              let key = documentFontFor(other.name, other) ?? matchFont(other.name, undefined, other);
              const emb = doc.rewritable ? await buildEmbeddedFont(doc.bytes, page, name) : null;
              try {
                await ensureCssFont(key);
              } catch {
                key = matchFont(other.name, undefined, other);
                await ensureCssFont(key).catch(() => undefined);
              }
              return { fontKey: key, ...(emb ? { embedded: emb } : {}) };
            }),
          )
        : [];
      const covers = asBlock
        ? asBlock.lines.map((l) => coverFor([l.origin[0], l.origin[1] - l.fontSize * 0.25, l.origin[0] + l.width, l.origin[1] + l.fontSize * 0.95], l.origin, 0, l.width, l.fontSize))
        : [coverFor(run.rect, run.baseline, run.angle, run.width ?? run.rect[2] - run.rect[0], run.fontSize)];
      const text: Annotation = {
        id: textId,
        kind: "text",
        pageId,
        origin: asBlock ? [asBlock.left, asBlock.lines[0].origin[1]] : run.baseline,
        text: asBlock ? asBlock.text : run.str,
        ...(asBlock
          ? {
              // Légère marge : les mesures de l'écran et du PDF diffèrent de quelques centièmes.
              box: {
                width: asBlock.width + asBlock.fontSize * 0.05,
                align: asBlock.align,
                lineHeight: Math.round(asBlock.lineHeight * 100) / 100,
                lines: asBlock.lines.length,
                ...(asBlock.space ? { space: Math.round(asBlock.space * 100) / 100 } : {}),
                original: asBlock.lines.map((l) => ({ text: l.text, x: l.origin[0] - asBlock.left, w: l.width })),
              },
              ...(mixed && mixed.styles.length ? { styles: mixed.styles, fonts: extraFonts } : {}),
            }
          : {}),
        fontKey,
        fontSize: Math.round((asBlock ? asBlock.fontSize : run.fontSize) * 10) / 10,
        color: color ?? "#000000",
        opacity: 1,
        rotation: run.angle,
        ...(real ? { originalFont: { name: real, bold: info.bold, italic: info.italic } } : {}),
        ...(embedded ? { embedded } : {}),
      };
      // Ouvert en édition seulement : rien n'est enregistré tant que le texte n'a pas changé.
      setPendingEdit({ covers, text: text as TextAnnotation, snapshot: JSON.stringify(text) });
      // On reste en mode « Modifier le texte » pour enchaîner les modifications.
      setSelectedId(text.id);
      if (!isMobile()) setPropsOpen(true);
      // Signale seulement une vraie substitution (autre famille que l'originale).
      const chosen = getFont(fontKey);
      const original = (real ?? "").replace(/^[A-Z]{6}\+/, "");
      const sameFamily =
        normalizeFontName(chosen.family ?? chosen.label).startsWith(parseFontName(original).base) ||
        (chosen.source === "standard" && /^(helvetica|times|courier)/.test(parseFontName(original).base));
      // Les équivalents métriques (Carlito pour Calibri…) gardent la mise en page : pas d'alerte.
      if (original && !embedded && !sameFamily && chosen.category !== "metric") {
        notify(t("Police d'origine « {original} » remplacée par l'équivalent « {font} ».", { original, font: chosen.label }));
      }
    },
    [doc, setPendingEdit, notify],
  );

  const onPlace = useCallback(
    (pageId: string, at: Point, rotation: number) => {
      if (!pending || !doc) return;
      if (pending.group) {
        const placed = layoutParts(pending.group, at, rotation).map(
          (p): Annotation =>
            p.type === "image"
              ? { id: newId("annot"), kind: "image", pageId, rect: p.rect, dataUrl: p.dataUrl, color: "#000000", opacity: 1 }
              : { id: newId("annot"), kind: "text", pageId, origin: p.origin, text: p.text, fontKey: p.fontKey, fontSize: p.fontSize, color: p.color, opacity: 1, rotation: p.rotation },
        );
        addAnnotations(...placed);
        setPending(null);
        // Rien de sélectionné : le texte posé n'ouvre pas le clavier du téléphone.
        setTool("select");
        setSelectedId(null);
        return;
      }
      const width = { signature: 160, stamp: 150, image: Math.min(240, pending.w * 0.75) }[pending.kind];
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
      addAnnotations(a);
      // Un tampon choisi reste prêt à être reposé ; image et signature sont posées une fois.
      if (pending.kind !== "stamp") {
        setPending(null);
        setTool("select");
        setSelectedId(a.id);
      }
    },
    [pending, doc, addAnnotations],
  );

  /**
   * Paraphe(s) au même endroit de chaque page (position choisie dans l'aperçu),
   * décalées à côté des éléments déjà posés ; une seule étape annulable.
   */
  const initialsEverywhere = async (part: PlacePart, chosen: PagePosition | null) => {
    if (!doc || !pdf) return;
    const added: Annotation[] = [];
    const w = partWidth(part);
    const h = partHeight(part);
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const size = { width: vp.width, height: vp.height };
      const obstacles = obstaclesOn(doc.annotations, doc.pageIds[i], vp);
      const pos = chosen ?? cornerPosition("right", w, h, size);
      const box = freeSpot(boxAt(pos, w, h, size), obstacles, size, pos.fx > 0.5 ? "left" : "right");
      const [x, y] = vp.convertToPdfPoint((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
      for (const p of layoutParts([part], [x, y], page.rotate)) {
        if (p.type === "image") added.push({ id: newId("annot"), kind: "image", pageId: doc.pageIds[i], rect: p.rect, dataUrl: p.dataUrl, color: "#000000", opacity: 1 });
      }
    }
    addAnnotations(...added);
    notify(tn("Paraphe ajoutée sur {n} page (Ctrl+Z pour annuler).", "Paraphe ajoutée sur {n} pages (Ctrl+Z pour annuler).", pdf.numPages));
  };

  const startImage = async (dataUrl: string, kind: PendingKind) => {
    const { w, h } = await imageSize(dataUrl);
    setPending({ dataUrl, w, h, kind });
    setTool(kind === "stamp" ? "stamp" : "image");
    setSelectedId(null);
    notify(kind === "stamp" ? t("Touchez la page pour poser le tampon (plusieurs fois si besoin).") : t("Touchez la page à l'endroit où placer l'image."));
  };

  // ------------------------------------------------------------- pages

  const pageOp = async (label: string, run: (d: DocState) => Promise<ops.PagesResult>, fixAnnotations?: (d: DocState, r: ops.PagesResult) => Annotation[]) => {
    if (!doc) return;
    if (!doc.rewritable) return notify(t("Les pages de ce PDF protégé ne peuvent pas être réorganisées."), true);
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
    if (!doc || !pdf) throw new Error(t("Aucun document ouvert."));
    if (doc.rewritable) return exportPdf(doc.bytes, doc.pageIds, doc.annotations);
    return rasterExport(pdf, doc.pageIds, doc.annotations, (n, total) => setBusy(t("Préparation {n}/{total}…", { n, total })));
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

  const saveAs = (name: string) => withExport(t("Enregistrement…"), (b) => download(b, name.replace(/\.pdf$/i, "") + ".pdf"));

  const shareAs = (name: string) =>
    withExport(t("Préparation du partage…"), async (b) => {
      const file = new File([b as BlobPart], name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
      else download(b, name);
    });

  // Le nom du fichier est choisi à chaque enregistrement ou partage.
  const save = () => setAskName("save");
  const share = () => setAskName("share");

  const confirmName = (fileName: string, base: string, date: string | null) => {
    const kind = askName;
    setAskName(null);
    setDoc((d) => (d ? { ...d, name: fileName, fileBase: base, fileDate: date } : d));
    if (kind === "share") shareAs(fileName);
    else saveAs(fileName);
  };

  const finishScan = async (bytes: Uint8Array, pages: number) => {
    setScanOpen(false);
    setBusy(t("Ouverture…"));
    try {
      await loadDocument(bytes, buildFileName({ base: "Scan", date: isoDate(), ...loadNamePrefs() }), { scan: true });
      notify(
        tn(
          "Document numérisé : {n} page. Son nom vous sera demandé à l'enregistrement.",
          "Document numérisé : {n} pages. Son nom vous sera demandé à l'enregistrement.",
          pages,
        ),
        false,
        5000,
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const print = () =>
    withExport(t("Préparation de l'impression…"), (b) => {
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
    withExport(t("Extraction…"), async (b) => {
      const indices = doc!.pageIds.map((id, i) => (selectedPages.has(id) ? i : -1)).filter((i) => i >= 0);
      download(await ops.extractPages(b, indices), doc!.name.replace(/\.pdf$/i, "") + "-extrait.pdf");
    });

  /** Exporte la page courante (annotations comprises) en image PNG. */
  const exportPageImage = () =>
    withExport(t("Export de la page en image…"), async (b) => {
      const rendered = await openPdf(b);
      try {
        const page = await rendered.getPage(currentPage + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 3000 / Math.max(base.width, base.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((x) => (x ? res(x) : rej(new Error(t("Rendu impossible")))), "image/png"));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${doc!.name.replace(/\.pdf$/i, "")}-page-${currentPage + 1}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } finally {
        await rendered.loadingTask.destroy();
      }
    });

  // Détection des scans : aucune des premières pages ne contient de texte.
  useEffect(() => {
    let alive = true;
    setScanned(false);
    if (!pdf || !doc?.rewritable) return;
    (async () => {
      for (let i = 0; i < Math.min(3, pdf.numPages); i++) if (await pageHasText(pdf, i)) return;
      if (alive) setScanned(true);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  /** Transformation de tout le document (numérotation, filigrane…), annulable. */
  const applyToDocument = async (
    label: string,
    transform: (bytes: Uint8Array) => Promise<Uint8Array | { bytes: Uint8Array; message: string }>,
  ) => {
    if (!doc) return;
    if (!doc.rewritable) {
      notify(t("Ce PDF protégé ne peut pas être modifié de cette façon."), true);
      return;
    }
    setBusy(label);
    try {
      const result = await transform(doc.bytes);
      const bytes = result instanceof Uint8Array ? result : result.bytes;
      if (bytes !== doc.bytes) commit({ bytes });
      notify(result instanceof Uint8Array ? t("Document mis à jour (Ctrl+Z pour annuler).") : result.message, false, 6000);
    } catch (e) {
      fail(e);
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const applyForm = async (values: FormValues, fontKey: string | undefined) => {
    if (!doc) return;
    setBusy(t("Remplissage du formulaire…"));
    try {
      commit({ bytes: await fillForm(doc.bytes, values, fontKey) });
      notify(t("Formulaire mis à jour."));
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
      } else if (e.key === "Escape" && pickResolve.current) {
        finishPick(null);
      } else if (e.key === "Escape") {
        setTool("select");
        setSelectedId(null);
        setPending(null);
      } else {
        const k = KEYS[e.key.toLowerCase()];
        if (k && doc && !locked) {
          setTool(k.tool);
          if (k.shape || k.doubleArrow !== undefined) {
            setStyle((s) => ({ ...s, ...(k.shape ? { shape: k.shape } : {}), ...(k.doubleArrow !== undefined ? { doubleArrow: k.doubleArrow } : {}) }));
          }
        }
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
          pageOp(t("Fusion…"), (d) => ops.appendDocuments(d.bytes, d.pageIds, others));
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
          if (f) startImage(await normalizeImage(f), "image").catch(fail);
        }}
      />
    </>
  );

  const scanner = scanOpen && (
    <Suspense fallback={<div className="busy">{t("Ouverture du scanner…")}</div>}>
      <Scanner onDone={finishScan} onCancel={() => setScanOpen(false)} />
    </Suspense>
  );

  if (!doc) {
    return (
      <div className={`welcome ${dragOver ? "drag" : ""}`}>
        {filePickers}
        <div className="welcome-card">
          <LanguagePicker className="welcome-lang" value={language} onChange={setLanguage} withLabel />
          <div className="logo">
            <Icon name="pages" size={40} />
          </div>
          <h1>Paperasse</h1>
          <p>{t("Lisez, annotez, modifiez, signez et réorganisez vos PDF. Tout reste sur votre appareil : rien n'est envoyé sur internet.")}</p>
          <button className="primary big" onClick={() => openInput.current?.click()}>
            <Icon name="open" /> {t("Ouvrir un fichier")}
          </button>
          <button className="big scan-btn" onClick={() => setScanOpen(true)}>
            <Icon name="camera" /> {t("Scanner un document")}
          </button>
          <div className="welcome-actions">
            <button onClick={newBlank}>{t("Nouveau PDF vierge")}</button>
            <button onClick={() => openInput.current?.click()}>{t("Images → PDF")}</button>
          </div>
          <button className="link" onClick={openSample}>
            {t("Essayer avec un exemple")}
          </button>
          <p className="hint">{t("ou glissez-déposez vos fichiers ici")}</p>
          {draft && (
            <div className="resume-card">
              <div>
                <strong>{t("Reprendre « {name} »", { name: draft.name })}</strong>
                <span>
                  {tn("{n} page", "{n} pages", draft.pages)}
                  {draft.edits ? tn(", {n} modification", ", {n} modifications", draft.edits) : ""} —{" "}
                  {t("enregistré {date}", { date: formatSavedAt(draft.savedAt) })}
                </span>
              </div>
              <div className="resume-actions">
                <button className="primary" onClick={resumeDraft}>
                  {t("Reprendre")}
                </button>
                <button onClick={discardDraft}>{t("Oublier")}</button>
              </div>
            </div>
          )}
        </div>
        {busy && <div className="busy">{busy}</div>}
        {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.msg}</div>}
        {scanner}
      </div>
    );
  }

  return (
    <div className={`app ${panel ? "with-panel" : ""} ${propsOpen ? "with-props" : ""} ${dragOver ? "drag" : ""}`}>
      {filePickers}
      <header className="topbar">
        <button
          className="icon-btn"
          title={t("Menu")}
          onClick={() => setMobileMenu(true)}
        >
          <Icon name="menu" />
        </button>
        <div className="doc-name" title={doc.name}>
          {doc.name}
        </div>
        <LanguagePicker className="desktop-only" value={language} onChange={setLanguage} withLabel />
        <div className="top-actions">
          <button className="open-btn" title={t("Ouvrir un fichier PDF ou une image (Ctrl+O)")} onClick={() => openInput.current?.click()}>
            <Icon name="open" />
            <span className="desktop-only">{t("Ouvrir un fichier")}</span>
          </button>
          <button className="icon-btn m-fit mobile-only" title={t("Ajuster à la largeur")} onClick={() => setFitWidth(true)}>
            <Icon name="fit" />
          </button>
          <button className="icon-btn" title={t("Annuler (Ctrl+Z)")} disabled={!past.current.length} onClick={undo}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" title={t("Rétablir (Ctrl+Y)")} disabled={!future.current.length} onClick={redo}>
            <Icon name="redo" />
          </button>
          <span className="sep desktop-only" />
          <button className="icon-btn desktop-only" title={t("Zoom arrière")} onClick={() => zoom(1 / 1.2)}>
            <Icon name="zoomOut" />
          </button>
          <button className="zoom-label desktop-only" title={t("Ajuster à la largeur")} onClick={() => setFitWidth(true)}>
            {Math.round(scale * 100)} %
          </button>
          <button className="icon-btn desktop-only" title={t("Zoom avant")} onClick={() => zoom(1.2)}>
            <Icon name="zoomIn" />
          </button>
          <span className="sep desktop-only" />
          <button className="icon-btn desktop-only" title={t("Rechercher (Ctrl+F)")} onClick={() => setPanel("search")}>
            <Icon name="search" />
          </button>
          {pdf && (
            <button className="page-chip mobile-only" title={t("Pages")} onClick={() => setPanel("pages")}>
              {currentPage + 1} / {pdf.numPages}
            </button>
          )}
          <button className="icon-btn desktop-only" title={t("Imprimer")} onClick={print}>
            <Icon name="print" />
          </button>
          <button className="icon-btn desktop-only" title={t("Partager")} onClick={share}>
            <Icon name="share" />
          </button>
          <button className="primary save-btn" title={t("Enregistrer (Ctrl+S)")} onClick={save}>
            <Icon name="save" /> <span className="desktop-only">{t("Enregistrer")}</span>
          </button>
        </div>
      </header>

      {locked && <div className="banner">{locked}</div>}
      {scanned && !locked && (
        <div className="banner info">
          <span>{t("Ce document semble être un scan : son texte n'est ni cherchable ni modifiable.")}</span>
          <span className="spacer" />
          <span className="banner-actions">
            <button className="primary" onClick={() => setOcrOpen(true)}>
              {t("Reconnaître le texte (OCR)")}
            </button>
            <button onClick={() => setScanned(false)}>{t("Ignorer")}</button>
          </span>
        </div>
      )}

      <nav className="toolbar" aria-label={t("Outils")}>
        {BUTTONS.map((b) => {
          // Un bouton groupé reprend le dernier outil utilisé dans son groupe.
          const target: Tool = b.id === "draw" ? lastDraw : b.id === "shapes" ? "shape" : b.tools[0];
          return (
            <button
              key={b.id}
              className={`tool ${b.tools.includes(tool) ? "active" : ""}`}
              title={`${t(b.label)}${b.key ? ` (${b.key})` : ""}${b.tools.length > 1 ? ` — ${t("choix à droite")}` : ""}`}
              disabled={!editable && b.id !== "select"}
              onClick={() => {
                setTool(target);
                setPending(null);
                if (target !== "select") setSelectedId(null);
                if (b.tools.length > 1) setPropsOpen(true);
              }}
            >
              <Icon name={b.icon} />
              <span>{t(b.label)}</span>
            </button>
          );
        })}
        <button className={`tool ${tool === "image" && pending?.kind === "signature" ? "active" : ""}`} disabled={!editable} onClick={() => setSigning(true)} title={t("Signer")}>
          <Icon name="sign" />
          <span>{t("Signer")}</span>
        </button>
        <button className={`tool ${tool === "image" && pending?.kind === "image" ? "active" : ""}`} disabled={!editable} onClick={() => imageInput.current?.click()} title={t("Image")}>
          <Icon name="image" />
          <span>{t("Image")}</span>
        </button>
        <span className="toolbar-sep" />
        <button className={`tool ${propsOpen ? "active" : ""}`} onClick={() => setPropsOpen((o) => !o)} title={t("Réglages")}>
          <Icon name="props" />
          <span>{t("Réglages")}</span>
        </button>
      </nav>

      <MobileBar
        tool={editable ? tool : "select"}
        style={style}
        selected={selected}
        editable={editable}
        placing={!!pending}
        onTool={(t) => {
          setTool(t);
          setPending(null);
          if (t !== "select") setSelectedId(null);
        }}
        onStyle={(p) => setStyle((s) => ({ ...s, ...p }))}
        onUpdate={onChange}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onDeselect={() => setSelectedId(null)}
        onAction={(a) => (a === "sign" ? setSigning(true) : a === "image" ? imageInput.current?.click() : setPanel("forms"))}
        onSettings={() => setPropsOpen(true)}
        onError={(m) => notify(m, true)}
        pickedColors={pickedColors}
        onPickColor={pickColor}
        fileFonts={fileFonts}
      />

      {mobileMenu && (
        <div className="mdrawer-wrap" onClick={() => setMobileMenu(false)}>
          <aside className="mdrawer" aria-label={t("Menu")} onClick={(e) => e.stopPropagation()}>
            <div className="mdrawer-head">
              <span className="mdrawer-logo">P</span>
              <span className="mdrawer-name">
                <strong>{doc.name}</strong>
                {pdf && <small>{tn("{n} page", "{n} pages", pdf.numPages)}</small>}
              </span>
            </div>
            {[
              { icon: "open", label: t("Ouvrir un fichier"), run: () => openInput.current?.click() },
              { icon: "camera", label: t("Scanner un document"), run: () => setScanOpen(true) },
              { icon: "pages", label: t("Pages et miniatures"), run: () => setPanel("pages") },
              { icon: "search", label: t("Rechercher"), run: () => setPanel("search") },
              { icon: "form", label: t("Formulaire"), run: () => setPanel("forms") },
              { icon: "merge", label: t("Ajouter un PDF ou une image"), run: () => mergeInput.current?.click(), off: !editable, sep: true },
              { icon: "pages", label: t("Numéroter les pages"), run: () => setDocTools("numbers"), off: !editable },
              { icon: "text", label: t("En-tête et pied de page"), run: () => setDocTools("headers"), off: !editable },
              { icon: "stamp", label: t("Filigrane"), run: () => setDocTools("watermark"), off: !editable },
              { icon: "compress", label: t("Compresser le PDF"), run: () => setDocTools("compress"), off: !editable || !doc.rewritable },
              { icon: "search", label: t("Reconnaissance de texte (OCR)"), run: () => setOcrOpen(true), off: !editable || !doc.rewritable },
              { icon: "share", label: t("Partager"), run: share, sep: true },
              { icon: "image", label: t("Exporter la page en image"), run: exportPageImage },
              { icon: "print", label: t("Imprimer"), run: print },
              { icon: "info", label: t("Propriétés du document"), run: () => setDocTools("properties"), off: !editable },
              { icon: "keyboard", label: t("Raccourcis clavier"), run: () => setShowShortcuts(true), sep: true, desktop: true },
            ].map((m: { icon: string; label: string; run: () => void; off?: boolean; sep?: boolean; desktop?: boolean }) => (
              <div key={m.label} className={m.desktop ? "desktop-only" : undefined}>
                {m.sep && <hr />}
                <button
                  className="mdrawer-item"
                  disabled={m.off}
                  onClick={() => {
                    setMobileMenu(false);
                    m.run();
                  }}
                >
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                </button>
              </div>
            ))}
            <hr />
            <LanguagePicker className="drawer-lang" value={language} onChange={setLanguage} withLabel />
          </aside>
        </div>
      )}

      {panel && <div className="backdrop mobile-only" onClick={() => setPanel(null)} />}
      {!panel && (
        <nav className="side-rail desktop-only" aria-label={t("Panneau")}>
          <button className="icon-btn" title={t("Afficher le panneau")} onClick={() => setPanel(lastPanel.current)}>
            <Icon name="expand" size={18} />
          </button>
          <hr />
          <button className="icon-btn" title={t("Pages")} onClick={() => setPanel("pages")}>
            <Icon name="pages" size={18} />
          </button>
          <button className="icon-btn" title={t("Recherche")} onClick={() => setPanel("search")}>
            <Icon name="search" size={18} />
          </button>
          <button className="icon-btn" title={t("Formulaire")} onClick={() => setPanel("forms")}>
            <Icon name="form" size={18} />
          </button>
        </nav>
      )}
      <aside className={`side-panel ${panel ? "open" : ""}`}>
        <div className="tabs" role="tablist">
          <button className={panel === "pages" ? "active" : ""} onClick={() => setPanel("pages")}>
            <Icon name="pages" size={16} /> {t("Pages")}
          </button>
          <button className={panel === "search" ? "active" : ""} onClick={() => setPanel("search")}>
            <Icon name="search" size={16} /> {t("Recherche")}
          </button>
          <button className={panel === "forms" ? "active" : ""} onClick={() => setPanel("forms")}>
            <Icon name="form" size={16} /> {t("Formulaire")}
          </button>
          <button className="icon-btn close mobile-only" onClick={() => setPanel(null)} title={t("Fermer")}>
            <Icon name="close" size={18} />
          </button>
          <button className="icon-btn close desktop-only" onClick={() => setPanel(null)} title={t("Réduire le panneau")}>
            <Icon name="collapse" size={18} />
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
            onRotate={(delta) => pageOp(t("Rotation…"), (d) => ops.rotatePages(d.bytes, d.pageIds, targetPages(), delta))}
            onDelete={() => {
              if (window.confirm(tn("Supprimer {n} page ?", "Supprimer {n} pages ?", selectedPages.size))) {
                pageOp(t("Suppression…"), (d) => ops.deletePages(d.bytes, d.pageIds, selectedPages));
              }
            }}
            onDuplicate={() => {
              const id = [...selectedPages][0];
              pageOp(
                t("Duplication…"),
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
              pageOp(t("Déplacement…"), (d) => ops.movePage(d.bytes, d.pageIds, from, to));
            }}
            onInsertBlank={() => pageOp(t("Insertion…"), (d) => ops.insertBlankPage(d.bytes, d.pageIds, currentPage))}
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
        className={`viewer tool-${picking ? "pipette" : tool}`}
        onScroll={onScroll}
        onPointerDown={(e) => {
          // Clic hors d'un élément : désélection. En mode « Ajouter du texte », un clic sur
          // la page crée (et sélectionne) un nouveau texte : on ne le désélectionne pas.
          const target = e.target as Element;
          const keeps = ["select", "editText", "text"].includes(tool);
          if (tool === "text" && target.closest(".overlay")) return;
          if (keeps && !target.closest("[data-annot], .handle, .inline-text")) setSelectedId(null);
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
                onErase={onErase}
                onFocusText={() => !isMobile() && setPropsOpen(true)}
                registerElement={registerElement}
                onPickColor={picking ? finishPick : undefined}
              />
            ))}
        </div>
        {pdf && (
          <div className="page-indicator">
            {currentPage + 1} / {pdf.numPages}
          </div>
        )}
        <div className="zoom-fab mobile-only">
          <button onClick={() => zoom(1 / 1.25)} aria-label={t("Zoom arrière")}>
            <Icon name="zoomOut" />
          </button>
          <button onClick={() => setFitWidth(true)} aria-label={t("Ajuster")}>
            <Icon name="fit" />
          </button>
          <button onClick={() => zoom(1.25)} aria-label={t("Zoom avant")}>
            <Icon name="zoomIn" />
          </button>
        </div>
      </main>

      <aside className={`props ${propsOpen ? "open" : ""}`}>
        <button className="icon-btn close mobile-only" onClick={() => setPropsOpen(false)} title={t("Fermer")}>
          <Icon name="close" size={18} />
        </button>
        <PropertiesPanel
          tool={tool}
          style={style}
          selected={selected}
          onStyle={(p) => setStyle((s) => ({ ...s, ...p }))}
          onUpdate={onChange}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onStamp={(url) => startImage(url, "stamp").catch(fail)}
          onTool={(t) => {
            setTool(t);
            setPending(null);
          }}
          onError={(m) => notify(m, true)}
          pickedColors={pickedColors}
          onPickColor={pickColor}
          fileFonts={fileFonts}
        />
      </aside>

      {docTools && (
        <DocumentTools bytes={doc.bytes} initialTab={docTools} onApply={applyToDocument} onClose={() => setDocTools(null)} />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {askName && doc && (
        <FileNameDialog
          base={doc.fileBase ?? doc.name.replace(/\.pdf$/i, "")}
          date={doc.fileBase !== undefined ? (doc.fileDate ?? null) : doc.scan ? isoDate() : null}
          action={askName === "share" ? t("Partager") : t("Enregistrer")}
          onConfirm={confirmName}
          onClose={() => setAskName(null)}
        />
      )}
      {scanner}
      {ocrOpen && pdf && (
        <OcrDialog
          pdf={pdf}
          language={language.language}
          currentPage={currentPage}
          onClose={() => setOcrOpen(false)}
          onError={(m) => notify(m, true)}
          onDone={async (pages) => {
            await applyToDocument(t("Ajout du texte reconnu…"), (b) => addInvisibleText(b, pages));
            setScanned(false);
            const words = [...pages.values()].reduce((n, w) => n + w.length, 0);
            notify(
              tn(
                "Texte reconnu : {words} mots sur {n} page. Le document est maintenant cherchable (Ctrl+Z pour annuler).",
                "Texte reconnu : {words} mots sur {n} pages. Le document est maintenant cherchable (Ctrl+Z pour annuler).",
                pages.size,
                { words },
              ),
            );
          }}
        />
      )}
      {signing && (
        <SignDialog
          pdf={pdf}
          annotations={doc.annotations}
          pageIds={doc.pageIds}
          currentPage={currentPage}
          fileFonts={fileFonts}
          onClose={() => setSigning(false)}
          onError={(m) => notify(m, true)}
          onInfo={(m) => notify(m, false, 6000)}
          onPlace={(group) => {
            setSigning(false);
            setPending({ dataUrl: "", w: 0, h: 0, kind: "signature", group });
            setTool("image");
            setSelectedId(null);
            notify(t("Touchez la page à l'endroit où signer."));
          }}
          onInitialsEverywhere={(part, pos) => {
            setSigning(false);
            initialsEverywhere(part, pos).catch(fail);
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
