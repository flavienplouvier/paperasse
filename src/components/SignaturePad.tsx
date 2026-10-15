import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** Rogne un canvas sur ses pixels non transparents et le renvoie en PNG. */
function trimToPng(c: HTMLCanvasElement): string | null {
  const { data, width, height } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  let x1 = width, y1 = height, x2 = 0, y2 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 <= x1 || y2 <= y1) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x2 - x1 + pad * 2;
  out.height = y2 - y1 + pad * 2;
  out.getContext("2d")!.drawImage(c, x1, y1, x2 - x1, y2 - y1, pad, pad, x2 - x1, y2 - y1);
  return out.toDataURL("image/png");
}

/**
 * Prépare une signature importée (photo, scan, PNG) : réduit sa taille et,
 * si demandé, rend le fond clair transparent avec un bord adouci.
 */
export async function importSignature(file: File, removeBackground: boolean): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (removeBackground) {
      const image = ctx.getImageData(0, 0, c.width, c.height);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        // Plus le pixel est clair, plus il devient transparent (seuils 170 → 235).
        const light = Math.min(d[i], d[i + 1], d[i + 2]);
        const alpha = light >= 235 ? 0 : light <= 170 ? 1 : (235 - light) / 65;
        d[i + 3] = Math.round(d[i + 3] * alpha);
      }
      ctx.putImageData(image, 0, 0);
    }
    const png = trimToPng(c);
    if (!png) throw new Error("L'image semble vide une fois le fond retiré. Décochez « Retirer le fond blanc ».");
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Signature dessinée (doigt, stylet, souris) ou importée depuis un fichier image. */
export function SignaturePad({
  onDone,
  onCancel,
  onError,
}: {
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState("#1a2b6d");
  const [empty, setEmpty] = useState(true);
  const [removeBackground, setRemoveBackground] = useState(true);
  const last = useRef<[number, number] | null>(null);

  useEffect(() => {
    const c = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const draw = (e: React.PointerEvent) => {
    if (!last.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const r = canvasRef.current!.getBoundingClientRect();
      const p: [number, number] = [ev.clientX - r.left, ev.clientY - r.top];
      ctx.strokeStyle = color;
      ctx.lineWidth = ev.pointerType === "pen" && ev.pressure > 0 ? 1.2 + ev.pressure * 3.2 : 2.6;
      ctx.beginPath();
      ctx.moveTo(...last.current);
      ctx.lineTo(...p);
      ctx.stroke();
      last.current = p;
    }
    setEmpty(false);
  };

  const clear = () => {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  const finish = () => {
    const png = trimToPng(canvasRef.current!);
    if (png) onDone(png);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Signature">
        <header>
          <h2>Votre signature</h2>
          <button className="icon-btn" onClick={onCancel} title="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <canvas
          ref={canvasRef}
          className="signature-canvas"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            last.current = pos(e);
          }}
          onPointerMove={draw}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
        <div className="modal-row">
          {["#1a2b6d", "#000000", "#0b6b3a", "#b3261e"].map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Couleur ${c}`}
            />
          ))}
          <span className="spacer" />
          <button onClick={clear}>Effacer</button>
          <button className="primary" disabled={empty} onClick={finish}>
            Placer la signature
          </button>
        </div>
        <div className="signature-import">
          <button onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> Importer une image de signature
          </button>
          <label className="field inline">
            <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} />
            Retirer le fond blanc
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                onDone(await importSignature(f, removeBackground));
              } catch (err) {
                onError(err instanceof Error ? err.message : "Image illisible.");
              }
            }}
          />
        </div>
        <p className="hint">
          Signez dans le cadre ou importez une photo / un scan de votre signature, puis touchez l'endroit de la page où
          la placer.
        </p>
      </div>
    </div>
  );
}
