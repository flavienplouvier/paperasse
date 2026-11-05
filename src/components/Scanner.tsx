import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { t, tn, useLocale } from "../i18n";
import { scansToPdf } from "../lib/pageOps";
import {
  SCAN_FILTERS,
  defaultQuad,
  detectDocument,
  enhance,
  outputSize,
  rotate90,
  warp,
  type Pixels,
  type Point,
  type Quad,
  type ScanFilter,
} from "../lib/scan";

/**
 * Numérisation à l'appareil photo, à la manière des applis de scan :
 * détection de la feuille en direct, recadrage ajustable au doigt, flash,
 * nettoyage des ombres, plusieurs pages, puis ouverture du PDF dans l'éditeur.
 */

interface ScanPage {
  id: string;
  photo: Blob;
  photoUrl: string;
  /** Dimensions de la photo (orientation appliquée). */
  width: number;
  height: number;
  quad: Quad;
  /** Quarts de tour dans le sens horaire. */
  rotation: number;
  filter: ScanFilter;
  result?: Blob;
  resultUrl?: string;
}

type Stage = { kind: "camera" } | { kind: "crop"; id: string; isNew: boolean } | { kind: "review"; id: string };

/** Taille maximale de la photo traitée (au-delà, la mémoire d'un téléphone sature). */
const MAX_SOURCE = 4000;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* navigation privée */
    }
  },
};

const pause = () => new Promise((r) => setTimeout(r, 30));

let counter = 0;
const newId = () => `scan-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function pixelsOf(src: CanvasImageSource, w: number, h: number, scale = 1): Pixels {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: d.data, width: d.width, height: d.height };
}

function toJpeg(p: Pixels, quality = 0.85): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  canvas.getContext("2d")!.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(t("Encodage de l'image impossible.")))), "image/jpeg", quality));
}

/** Détection sur une version réduite, coins ramenés aux dimensions de la source. */
function detectIn(src: CanvasImageSource, w: number, h: number): Quad | null {
  const f = Math.min(1, 320 / Math.max(w, h));
  const q = detectDocument(pixelsOf(src, w, h, f), 320);
  return q ? (q.map((p) => ({ x: p.x / f, y: p.y / f })) as Quad) : null;
}

async function pageFromBlob(photo: Blob, filter: ScanFilter): Promise<ScanPage> {
  const bmp = await createImageBitmap(photo, { imageOrientation: "from-image" });
  try {
    const quad = detectIn(bmp, bmp.width, bmp.height) ?? defaultQuad(bmp.width, bmp.height);
    return { id: newId(), photo, photoUrl: URL.createObjectURL(photo), width: bmp.width, height: bmp.height, quad, rotation: 0, filter };
  } finally {
    bmp.close();
  }
}

interface Props {
  onDone: (bytes: Uint8Array, pages: number) => void;
  onCancel: () => void;
}

export default function Scanner({ onDone, onCancel }: Props) {
  useLocale();
  const [stage, setStage] = useState<Stage>({ kind: "camera" });
  const [pages, setPages] = useState<ScanPage[]>([]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ----------------------------------------------------------------- caméra
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "off">("starting");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [flash, setFlash] = useState(() => store.get("paperasse-flash") === "on");
  const [live, setLive] = useState<Quad | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [shutter, setShutter] = useState(false);
  const nativeInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const filterRef = useRef<ScanFilter>((store.get("paperasse-scan-filtre") as ScanFilter) || "auto");

  const inCamera = stage.kind === "camera";

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera("off");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchAvailable(!!caps.torch);
        setCamera("on");
      } catch {
        if (alive) setCamera("off");
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Le flux est rattaché à la vidéo chaque fois que l'écran caméra réapparaît.
  useEffect(() => {
    const video = videoRef.current;
    if (!inCamera || camera !== "on" || !video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => undefined);
  }, [inCamera, camera]);

  // Flash : lampe allumée tant que l'écran caméra est affiché.
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchAvailable) return;
    track.applyConstraints({ advanced: [{ torch: flash && inCamera } as MediaTrackConstraintSet] }).catch(() => undefined);
  }, [flash, inCamera, torchAvailable]);

  // Détection en direct de la feuille.
  useEffect(() => {
    if (!inCamera || camera !== "on") return;
    const timer = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      if (v.videoWidth !== videoSize.w || v.videoHeight !== videoSize.h) setVideoSize({ w: v.videoWidth, h: v.videoHeight });
      setLive(detectIn(v, v.videoWidth, v.videoHeight));
    }, 350);
    return () => window.clearInterval(timer);
  }, [inCamera, camera, videoSize]);

  // ----------------------------------------------------------------- traitement
  /** Page redressée avant filtre, gardée pour changer de filtre instantanément. */
  const warped = useRef<{ key: string; pixels: Pixels } | null>(null);

  const render = useCallback(async (page: ScanPage): Promise<ScanPage> => {
    const key = `${page.id}|${JSON.stringify(page.quad)}|${page.rotation}`;
    let straight = warped.current?.key === key ? warped.current.pixels : null;
    if (!straight) {
      const bmp = await createImageBitmap(page.photo, { imageOrientation: "from-image" });
      try {
        const f = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
        const src = pixelsOf(bmp, bmp.width, bmp.height, f);
        const sx = src.width / page.width, sy = src.height / page.height;
        const q = page.quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
        const size = outputSize(q);
        straight = rotate90(warp(src, q, size.width, size.height), page.rotation);
      } finally {
        bmp.close();
      }
      warped.current = { key, pixels: straight };
    }
    const result = await toJpeg(enhance(straight, page.filter), page.filter === "original" ? 0.88 : 0.82);
    if (page.resultUrl) URL.revokeObjectURL(page.resultUrl);
    return { ...page, result, resultUrl: URL.createObjectURL(result) };
  }, []);

  const update = (page: ScanPage) => setPages((list) => list.map((p) => (p.id === page.id ? page : p)));

  const process = async (page: ScanPage) => {
    setBusy(t("Amélioration du document…"));
    await pause();
    try {
      const done = await render(page);
      update(done);
      return done;
    } catch (e) {
      setError((e as Error).message || t("Traitement impossible."));
      return page;
    } finally {
      setBusy(null);
    }
  };

  // ----------------------------------------------------------------- prise de vue
  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setShutter(true);
    setTimeout(() => setShutter(false), 180);
    setBusy(t("Capture…"));
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")!.drawImage(v, 0, 0);
      const photo = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(t("Capture impossible.")))), "image/jpeg", 0.92));
      const quad = detectIn(canvas, canvas.width, canvas.height) ?? defaultQuad(canvas.width, canvas.height);
      const page: ScanPage = {
        id: newId(),
        photo,
        photoUrl: URL.createObjectURL(photo),
        width: canvas.width,
        height: canvas.height,
        quad,
        rotation: 0,
        filter: filterRef.current,
      };
      setPages((list) => [...list, page]);
      setStage({ kind: "crop", id: page.id, isNew: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importPhotos = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!list.length) return;
    setBusy(t("Lecture des photos…"));
    await pause();
    try {
      const added: ScanPage[] = [];
      for (const f of list) added.push(await pageFromBlob(f, filterRef.current));
      setPages((ps) => [...ps, ...added]);
      if (added.length === 1) setStage({ kind: "crop", id: added[0].id, isNew: true });
      else {
        const rendered: ScanPage[] = [];
        for (const [i, p] of added.entries()) {
          setBusy(t("Amélioration {n}/{total}…", { n: i + 1, total: added.length }));
          await pause();
          rendered.push(await render(p));
        }
        setPages((ps) => ps.map((p) => rendered.find((r) => r.id === p.id) ?? p));
        setStage({ kind: "review", id: rendered[rendered.length - 1].id });
      }
    } catch {
      setError(t("Cette photo n'a pas pu être lue (format non pris en charge par le navigateur)."));
    } finally {
      setBusy(null);
    }
  };

  // ----------------------------------------------------------------- actions
  const current = stage.kind === "camera" ? undefined : pages.find((p) => p.id === stage.id);

  const removePage = (id: string) => {
    const page = pagesRef.current.find((p) => p.id === id);
    if (page) {
      URL.revokeObjectURL(page.photoUrl);
      if (page.resultUrl) URL.revokeObjectURL(page.resultUrl);
    }
    const rest = pagesRef.current.filter((p) => p.id !== id);
    setPages(rest);
    setStage(rest.length ? { kind: "review", id: rest[rest.length - 1].id } : { kind: "camera" });
  };

  const close = () => {
    if (pagesRef.current.length && !window.confirm(tn("Abandonner la page numérisée ?", "Abandonner les {n} pages numérisées ?", pagesRef.current.length))) return;
    onCancel();
  };

  const finish = async () => {
    setBusy(t("Création du PDF…"));
    await pause();
    try {
      const ready: ScanPage[] = [];
      for (const p of pagesRef.current) ready.push(p.result ? p : await render(p));
      const bytes = await scansToPdf(await Promise.all(ready.map(async (p) => new Uint8Array(await p.result!.arrayBuffer()))));
      onDone(bytes, ready.length);
    } catch (e) {
      setError((e as Error).message || t("Création du PDF impossible."));
      setBusy(null);
    }
  };

  // Libère les images à la fermeture.
  useEffect(
    () => () => {
      for (const p of pagesRef.current) {
        URL.revokeObjectURL(p.photoUrl);
        if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
      }
    },
    [],
  );

  const toggleFlash = () => {
    setFlash((f) => {
      store.set("paperasse-flash", f ? "off" : "on");
      return !f;
    });
  };

  const setFilter = async (filter: ScanFilter) => {
    if (!current || current.filter === filter) return;
    filterRef.current = filter;
    store.set("paperasse-scan-filtre", filter);
    await process({ ...current, filter });
  };

  // ----------------------------------------------------------------- écrans
  const pickers = (
    <>
      <input ref={nativeInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (importPhotos(e.target.files), (e.target.value = ""))} />
      <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={(e) => (importPhotos(e.target.files), (e.target.value = ""))} />
    </>
  );

  let body: React.ReactNode;
  if (stage.kind === "camera") {
    body = (
      <>
        <header className="scan-top">
          <button className="scan-icon" title={t("Fermer")} onClick={pages.length ? () => setStage({ kind: "review", id: pages[pages.length - 1].id }) : close}>
            <Icon name={pages.length ? "back" : "close"} />
          </button>
          <span className="scan-title">{pages.length ? t("Page {n}", { n: pages.length + 1 }) : t("Scanner un document")}</span>
          {torchAvailable ? (
            <button className={`scan-icon ${flash ? "on" : ""}`} title={flash ? t("Éteindre le flash") : t("Allumer le flash")} aria-pressed={flash} onClick={toggleFlash}>
              <Icon name={flash ? "flash" : "flashOff"} />
            </button>
          ) : (
            <span className="scan-icon-space" />
          )}
        </header>
        <div className="scan-stage">
          {camera === "on" ? (
            <>
              <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
              {live && videoSize.w > 0 && (
                <svg className="scan-live" viewBox={`0 0 ${videoSize.w} ${videoSize.h}`} preserveAspectRatio="xMidYMid slice">
                  <polygon points={live.map((p) => `${p.x},${p.y}`).join(" ")} />
                </svg>
              )}
              <p className="scan-tip">{live ? t("Document détecté") : t("Cadrez le document sur un fond contrasté")}</p>
            </>
          ) : camera === "starting" ? (
            <p className="scan-tip static">{t("Ouverture de la caméra…")}</p>
          ) : (
            <div className="scan-nocam">
              <Icon name="camera" size={40} />
              <p>{t("La caméra n'est pas accessible depuis la page. Utilisez l'appareil photo du téléphone ou choisissez une photo.")}</p>
              <button className="primary" onClick={() => nativeInput.current?.click()}>
                <Icon name="camera" /> {t("Prendre une photo")}
              </button>
            </div>
          )}
          {shutter && <div className="scan-shutter" />}
        </div>
        <footer className="scan-bottom">
          <button className="scan-icon" title={t("Importer des photos")} onClick={() => galleryInput.current?.click()}>
            <Icon name="image" />
          </button>
          <button className="scan-capture" title={t("Prendre la photo")} disabled={camera !== "on" || !!busy} onClick={capture}>
            <span />
          </button>
          {pages.length ? (
            <button className="scan-stack" title={t("Voir les pages")} onClick={() => setStage({ kind: "review", id: pages[pages.length - 1].id })}>
              {pages[pages.length - 1].resultUrl ? <img src={pages[pages.length - 1].resultUrl} alt="" /> : null}
              <b>{pages.length}</b>
            </button>
          ) : (
            <button className="scan-icon" title={t("Appareil photo du téléphone (avec son flash)")} onClick={() => nativeInput.current?.click()}>
              <Icon name="camera" />
            </button>
          )}
        </footer>
      </>
    );
  } else if (stage.kind === "crop" && current) {
    body = (
      <CropStage
        page={current}
        onCancel={() => (stage.isNew ? removePage(current.id) : setStage({ kind: "review", id: current.id }))}
        onConfirm={async (quad) => {
          const done = await process({ ...current, quad });
          update(done);
          setStage({ kind: "review", id: done.id });
        }}
        busy={!!busy}
      />
    );
  } else if (stage.kind === "review" && current) {
    body = (
      <>
        <header className="scan-top">
          <button className="scan-icon" title={t("Annuler")} onClick={close}>
            <Icon name="close" />
          </button>
          <span className="scan-title">{t("Page {n} / {total}", { n: pages.indexOf(current) + 1, total: pages.length })}</span>
          <button className="scan-done" disabled={!!busy} onClick={finish}>
            <Icon name="check" /> {t("Terminer")}
          </button>
        </header>
        <div className="scan-stage review">{current.resultUrl ? <img className="scan-result" src={current.resultUrl} alt={t("Page {n}", { n: pages.indexOf(current) + 1 })} /> : null}</div>
        <div className="scan-filters" role="radiogroup" aria-label={t("Rendu")}>
          {SCAN_FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={current.filter === f.id} className={current.filter === f.id ? "active" : ""} disabled={!!busy} onClick={() => setFilter(f.id)}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <div className="scan-strip">
          {pages.map((p, i) => (
            <button key={p.id} className={p.id === current.id ? "active" : ""} title={t("Page {n}", { n: i + 1 })} onClick={() => setStage({ kind: "review", id: p.id })}>
              {p.resultUrl ? <img src={p.resultUrl} alt="" /> : <span>{i + 1}</span>}
            </button>
          ))}
          <button className="scan-add" title={t("Ajouter une page")} onClick={() => setStage({ kind: "camera" })}>
            <Icon name="plus" />
          </button>
        </div>
        <footer className="scan-tools">
          <button onClick={() => setStage({ kind: "crop", id: current.id, isNew: false })}>
            <Icon name="crop" />
            <span>{t("Recadrer")}</span>
          </button>
          <button disabled={!!busy} onClick={() => process({ ...current, rotation: (current.rotation + 1) % 4 })}>
            <Icon name="rotateR" />
            <span>{t("Pivoter")}</span>
          </button>
          <button onClick={() => setStage({ kind: "camera" })}>
            <Icon name="camera" />
            <span>{t("Ajouter")}</span>
          </button>
          <button onClick={() => removePage(current.id)}>
            <Icon name="trash" />
            <span>{t("Supprimer")}</span>
          </button>
        </footer>
      </>
    );
  }

  return (
    <div className="scanner" role="dialog" aria-label={t("Numérisation")}>
      {pickers}
      {body}
      {busy && (
        <div className="scan-busy">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {error && (
        <div className="scan-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ recadrage

function CropStage({ page, onCancel, onConfirm, busy }: { page: ScanPage; onCancel: () => void; onConfirm: (q: Quad) => void; busy: boolean }) {
  useLocale();
  const [quad, setQuad] = useState<Quad>(page.quad);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ corner: number; dx: number; dy: number } | null>(null);
  const full = defaultQuad(page.width, page.height, 0);
  const isFull = quad.every((p, i) => Math.abs(p.x - full[i].x) < 1 && Math.abs(p.y - full[i].y) < 1);

  // Image affichée en entier dans la zone disponible.
  useLayoutEffect(() => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    const fit = () => {
      const s = Math.min((el.clientWidth - 32) / page.width, (el.clientHeight - 32) / page.height);
      setBox({ w: page.width * s, h: page.height * s });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.width, page.height]);

  const scale = box.w / page.width || 1;
  const toImage = (e: React.PointerEvent): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const down = (corner: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toImage(e);
    setDrag({ corner, dx: quad[corner].x - p.x, dy: quad[corner].y - p.y });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toImage(e);
    const x = Math.min(page.width, Math.max(0, p.x + drag.dx));
    const y = Math.min(page.height, Math.max(0, p.y + drag.dy));
    setQuad((q) => q.map((c, i) => (i === drag.corner ? { x, y } : c)) as Quad);
  };

  const active = drag ? quad[drag.corner] : null;
  const ZOOM = 2.5;
  const LOUPE = 110;

  return (
    <>
      <header className="scan-top">
        <button className="scan-icon" title={t("Annuler")} onClick={onCancel}>
          <Icon name="back" />
        </button>
        <span className="scan-title">{t("Ajuster les bords")}</span>
        <button className="scan-done" disabled={busy} onClick={() => onConfirm(quad)}>
          <Icon name="check" /> {t("Valider")}
        </button>
      </header>
      <div className="scan-stage crop">
        <div ref={boxRef} className="crop-box" style={{ width: box.w, height: box.h }} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <img src={page.photoUrl} alt="" draggable={false} />
          <svg viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none">
            <path className="crop-shade" fillRule="evenodd" d={`M0 0H${page.width}V${page.height}H0Z M${quad.map((p) => `${p.x} ${p.y}`).join(" L")}Z`} />
            <polygon className="crop-edge" points={quad.map((p) => `${p.x},${p.y}`).join(" ")} />
          </svg>
          {quad.map((p, i) => (
            <span
              key={i}
              className={`crop-handle ${drag?.corner === i ? "active" : ""}`}
              style={{ left: p.x * scale, top: p.y * scale }}
              onPointerDown={down(i)}
              role="slider"
              aria-label={[t("Coin haut gauche"), t("Coin haut droit"), t("Coin bas droit"), t("Coin bas gauche")][i]}
            />
          ))}
          {active && (
            <span
              className="crop-loupe"
              style={{
                left: active.x * scale,
                top: active.y * scale,
                backgroundImage: `url(${page.photoUrl})`,
                backgroundSize: `${box.w * ZOOM}px ${box.h * ZOOM}px`,
                backgroundPosition: `${LOUPE / 2 - active.x * scale * ZOOM}px ${LOUPE / 2 - active.y * scale * ZOOM}px`,
              }}
            />
          )}
        </div>
      </div>
      <footer className="scan-tools">
        <button onClick={() => setQuad(isFull ? page.quad : full)}>
          <Icon name={isFull ? "scan" : "fit"} />
          <span>{isFull ? t("Détection") : t("Page entière")}</span>
        </button>
      </footer>
    </>
  );
}
