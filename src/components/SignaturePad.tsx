import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** Zone de signature au doigt, au stylet ou à la souris. Produit un PNG rogné et transparent. */
export function SignaturePad({ onDone, onCancel }: { onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#1a2b6d");
  const [empty, setEmpty] = useState(true);
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
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x1 = width, y1 = height, x2 = 0, y2 = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          if (x < x1) x1 = x;
          if (x > x2) x2 = x;
          if (y < y1) y1 = y;
          if (y > y2) y2 = y;
        }
      }
    }
    if (x2 <= x1 || y2 <= y1) return;
    const pad = 6;
    const out = document.createElement("canvas");
    out.width = x2 - x1 + pad * 2;
    out.height = y2 - y1 + pad * 2;
    out.getContext("2d")!.drawImage(c, x1, y1, x2 - x1, y2 - y1, pad, pad, x2 - x1, y2 - y1);
    onDone(out.toDataURL("image/png"));
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
        <p className="hint">Signez dans le cadre, puis touchez l'endroit de la page où la placer.</p>
      </div>
    </div>
  );
}
