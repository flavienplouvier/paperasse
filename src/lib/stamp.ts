import { currentLocale, msg, t } from "../i18n";

/**
 * Tampons : rectangle, rond (texte sur le pourtour, logo ou texte au centre)
 * ou ovale, avec un effet d'encre usée et une légère inclinaison, comme un
 * vrai coup de tampon. Rendu en PNG transparent haute résolution.
 */

export type StampShape = "rect" | "round" | "oval";
export type StampFont = "block" | "typewriter" | "serif";

export interface StampSpec {
  shape: StampShape;
  /** Texte du centre (plusieurs lignes possibles). */
  text: string;
  /** Rond : texte du pourtour, en haut. */
  ring?: string;
  /** Rond : texte du pourtour, en bas. */
  ringBottom?: string;
  color: string;
  withDate: boolean;
  /** Usure de l'encre, de 0 (net) à 1 (très usé). */
  wear: number;
  /** Inclinaison en degrés. */
  angle: number;
  /** Logo au centre (PNG transparent), teinté de la couleur de l'encre. */
  logo?: string;
  /** Double cadre. */
  double?: boolean;
  font?: StampFont;
}

/** Modèles prêts à l'emploi : libellé et couleur. */
export const STAMPS: { label: string; color: string }[] = [
  { label: msg("Approuvé"), color: "#1f8a4c" },
  { label: msg("Payé"), color: "#1f8a4c" },
  { label: msg("Reçu"), color: "#1d5fbf" },
  { label: msg("Vu"), color: "#1d5fbf" },
  { label: msg("Brouillon"), color: "#6b7280" },
  { label: msg("Copie"), color: "#6b7280" },
  { label: msg("Confidentiel"), color: "#c62828" },
  { label: msg("Urgent"), color: "#c62828" },
  { label: msg("Refusé"), color: "#c62828" },
  { label: msg("Annulé"), color: "#c62828" },
];

export const STAMP_SHAPES: { id: StampShape; label: string }[] = [
  { id: "rect", label: msg("Rectangle") },
  { id: "round", label: msg("Rond") },
  { id: "oval", label: msg("Ovale") },
];

export const STAMP_FONTS: { id: StampFont; label: string; css: string }[] = [
  { id: "block", label: msg("Bâton"), css: `800 {size}px "Arial Black", system-ui, "Segoe UI", Roboto, Arial, sans-serif` },
  { id: "typewriter", label: msg("Machine à écrire"), css: `700 {size}px "Courier New", Courier, "Liberation Mono", monospace` },
  { id: "serif", label: msg("Classique"), css: `700 {size}px Georgia, "Times New Roman", serif` },
];

export function todayLabel(date = new Date()): string {
  return date.toLocaleDateString(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Compatibilité : tampon rectangle simple. */
export function renderStamp(label: string, color: string, withDate: boolean): string {
  return renderStampSpec({ shape: "rect", text: label, color, withDate, wear: 0, angle: 0 });
}

// ------------------------------------------------------------------ rendu

const upper = (s: string) => s.toLocaleUpperCase(currentLocale());
const fontCss = (f: StampFont | undefined, size: number) => (STAMP_FONTS.find((x) => x.id === f) ?? STAMP_FONTS[0]).css.replace("{size}", String(size));

/** Générateur pseudo-aléatoire déterministe (même tampon → même usure). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Bruit de valeur lissé sur une grille (encre plus ou moins chargée). */
function valueNoise(w: number, h: number, cell: number, rand: () => number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh).map(() => rand());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = y / cell;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1], c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

/** Encre usée : charge inégale, petits manques et grain, plus marqués avec `wear`. */
function wearInk(ctx: CanvasRenderingContext2D, w: number, h: number, wear: number, seed: number, unit: number) {
  if (wear <= 0) return;
  const rand = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const broad = valueNoise(w, h, 40 * unit, rand);
  const mid = valueNoise(w, h, 9 * unit, rand);
  const fine = valueNoise(w, h, 2.2 * unit, rand);
  for (let p = 0, i = 3; p < w * h; p++, i += 4) {
    if (!d[i]) continue;
    // Charge d'encre : zones plus pâles (pression inégale).
    let k = 1 - wear * 0.45 * Math.max(0, broad[p] - 0.35) * 1.6;
    // Manques : là où le bruit moyen + fin passe sous un seuil, l'encre n'a pas pris.
    const hole = mid[p] * 0.65 + fine[p] * 0.35;
    const threshold = 0.18 + wear * 0.22;
    if (hole < threshold) k *= Math.max(0, (hole - (threshold - 0.06)) / 0.06);
    // Grain.
    k *= 1 - wear * 0.25 * rand();
    d[i] = Math.round(d[i] * Math.max(0, Math.min(1, k)));
  }
  ctx.putImageData(img, 0, 0);
}

function fitFont(ctx: CanvasRenderingContext2D, lines: string[], font: StampFont | undefined, maxWidth: number, maxSize: number, minSize: number): number {
  for (let size = maxSize; size > minSize; size -= 2) {
    ctx.font = fontCss(font, size);
    if (lines.every((l) => ctx.measureText(l).width <= maxWidth)) return size;
  }
  return minSize;
}

/** Texte le long d'un arc, centré sur `mid` (radians) ; `outside` : lettres tournées vers l'extérieur (haut) ou l'intérieur (bas). */
function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, mid: number, top: boolean) {
  const spacing = ctx.measureText(" ").width * 0.25;
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let angle = mid - ((top ? 1 : -1) * total) / r / 2;
  for (const [i, ch] of [...text].entries()) {
    const half = widths[i] / 2 / r;
    angle += top ? half : -half;
    ctx.save();
    ctx.translate(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    ctx.rotate(top ? angle + Math.PI / 2 : angle - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += top ? half : -half;
  }
}

function tinted(img: HTMLImageElement, color: string, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Image déjà décodée (logos) : le rendu reste synchrone. */
const logoCache = new Map<string, HTMLImageElement>();
export function preloadLogo(dataUrl: string): Promise<void> {
  if (logoCache.has(dataUrl)) return Promise.resolve();
  const img = new Image();
  img.src = dataUrl;
  return img.decode().then(() => void logoCache.set(dataUrl, img));
}

/**
 * Dessine le tampon. `scale` règle la résolution (3 pour la pose, 1 pour les
 * aperçus). Un logo doit avoir été chargé avec `preloadLogo`.
 */
export function renderStampSpec(spec: StampSpec, scale = 3): string {
  const u = scale;
  const ink = document.createElement("canvas");
  const ctx = ink.getContext("2d", { willReadFrequently: true })!;
  const date = spec.withDate ? todayLabel() : "";
  const lines = upper(spec.text.trim() || (spec.logo || spec.ring ? "" : t("TAMPON"))).split("\n").filter(Boolean);
  const logo = spec.logo ? logoCache.get(spec.logo) : undefined;
  const lw = 3.2 * u;

  if (spec.shape === "round") {
    const R = 100 * u;
    ink.width = ink.height = Math.ceil(2 * R + lw * 2);
    const c = ink.width / 2;
    ctx.strokeStyle = ctx.fillStyle = spec.color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    const hasRing = !!(spec.ring?.trim() || spec.ringBottom?.trim());
    const inner = hasRing ? R * 0.68 : R - 7 * u;
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.arc(c, c, inner, 0, Math.PI * 2);
    ctx.stroke();
    if (hasRing) {
      const rText = (R + inner) / 2;
      // Chaque texte tient dans sa moitié de cercle (≈ 140°), laissant la place aux étoiles.
      let ringSize = Math.round(R * 0.2);
      ctx.font = fontCss(spec.font, ringSize);
      const longest = Math.max(...[spec.ring, spec.ringBottom].map((x) => (x?.trim() ? ctx.measureText(upper(x.trim())).width * 1.08 : 0)));
      const room = rText * Math.PI * 0.78;
      if (longest > room) ringSize = Math.max(8 * u, Math.floor((ringSize * room) / longest));
      ctx.font = fontCss(spec.font, ringSize);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (spec.ring?.trim()) arcText(ctx, upper(spec.ring.trim()), c, c, rText, -Math.PI / 2, true);
      if (spec.ringBottom?.trim()) arcText(ctx, upper(spec.ringBottom.trim()), c, c, rText, Math.PI / 2, false);
      // Étoiles de séparation entre le haut et le bas.
      ctx.font = fontCss(spec.font, Math.round(ringSize * 0.8));
      ctx.fillText("★", c - rText, c);
      ctx.fillText("★", c + rText, c);
    }
    const area = inner * 1.55;
    let y = c;
    if (logo) {
      const k = Math.min((area * (lines.length || date ? 0.62 : 0.85)) / logo.naturalWidth, (area * (lines.length || date ? 0.55 : 0.85)) / logo.naturalHeight);
      const w = logo.naturalWidth * k, h = logo.naturalHeight * k;
      const top = lines.length || date ? c - inner * 0.72 : c - h / 2;
      ctx.drawImage(tinted(logo, spec.color, w, h), c - w / 2, top, w, h);
      y = top + h + 6 * u;
    }
    const centerLines = [...lines, ...(date ? [date] : [])];
    if (centerLines.length) {
      const size = fitFont(ctx, centerLines, spec.font, area, Math.round(inner * (logo ? 0.28 : 0.42)), 8 * u);
      ctx.font = fontCss(spec.font, size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lh = size * 1.12;
      if (!logo) y = c - ((centerLines.length - 1) * lh) / 2;
      else y += lh / 2;
      for (const l of centerLines) {
        ctx.fillText(l, c, y);
        y += lh;
      }
    }
  } else {
    // Rectangle ou ovale : texte (et logo) au centre, cadre simple ou double.
    const pad = (spec.shape === "oval" ? 30 : 14) * u;
    const size0 = 30 * u;
    ctx.font = fontCss(spec.font, size0);
    const textW = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
    const small = 14 * u;
    ctx.font = fontCss(spec.font, small);
    const dateW = date ? ctx.measureText(date).width : 0;
    const logoH = logo ? 46 * u : 0;
    const logoW = logo ? (logo.naturalWidth / logo.naturalHeight) * logoH : 0;
    const contentW = Math.max(textW, dateW, logoW, 40 * u);
    const contentH = logoH + (logo && lines.length ? 6 * u : 0) + lines.length * size0 * 1.1 + (date ? small * 1.5 : 0);
    const frame = spec.double ? 6 * u : 0;
    ink.width = Math.ceil(contentW + pad * 2 + lw * 2 + frame * 2);
    ink.height = Math.ceil(contentH + pad * (spec.shape === "oval" ? 1.2 : 1.4) + lw * 2 + frame * 2);
    const W = ink.width, H = ink.height;
    ctx.strokeStyle = ctx.fillStyle = spec.color;
    ctx.lineWidth = lw;
    const outline = (inset: number, width: number) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      if (spec.shape === "oval") ctx.ellipse(W / 2, H / 2, W / 2 - inset, H / 2 - inset, 0, 0, Math.PI * 2);
      else ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, 8 * u);
      ctx.stroke();
    };
    outline(lw / 2, lw);
    if (spec.double) outline(lw + frame, lw * 0.55);
    let y = (H - contentH) / 2;
    if (logo) {
      ctx.drawImage(tinted(logo, spec.color, logoW, logoH), (W - logoW) / 2, y, logoW, logoH);
      y += logoH + (lines.length ? 6 * u : 0);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = fontCss(spec.font, size0);
    for (const l of lines) {
      ctx.fillText(l, W / 2, y + size0 * 0.05);
      y += size0 * 1.1;
    }
    if (date) {
      ctx.font = fontCss(spec.font, small);
      ctx.fillText(date, W / 2, y + small * 0.3);
    }
  }

  wearInk(ctx, ink.width, ink.height, spec.wear, hash(JSON.stringify([spec.text, spec.ring, spec.ringBottom, spec.shape])), u);

  // Inclinaison : on tourne le tampon dans un canevas assez grand, sans rogner.
  const a = (spec.angle * Math.PI) / 180;
  if (!a) return ink.toDataURL("image/png");
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const out = document.createElement("canvas");
  out.width = Math.ceil(ink.width * cos + ink.height * sin);
  out.height = Math.ceil(ink.width * sin + ink.height * cos);
  const o = out.getContext("2d")!;
  o.translate(out.width / 2, out.height / 2);
  o.rotate(a);
  o.drawImage(ink, -ink.width / 2, -ink.height / 2);
  return out.toDataURL("image/png");
}
