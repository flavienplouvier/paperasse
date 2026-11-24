import { describe, expect, it } from "vitest";
import { detectDocument, homography, type Pixels, type Quad } from "./scan";

/**
 * Photos simulées plus proches du réel : feuille en perspective avec texte,
 * bandeaux sombres, ombre, lumière chaude, table claire ou feuille qui touche le bord.
 */
const W = 900, H = 1200, DW = 850, DH = 1200;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function scene(opts: { quad: Quad; bg: (x: number, y: number) => [number, number, number]; dark?: [number, number, number, number][]; shade?: number; tint?: [number, number, number] }): Pixels {
  // Document → photo : on inverse l'homographie photo ← document pour chaque pixel.
  const [a, b, c, d, e, f, g, h] = homography(DW, DH, opts.quad);
  // Inverse de la matrice 3x3.
  const m = [a, b, c, d, e, f, g, h, 1];
  const inv = invert3(m);
  const lines: [number, number, number][] = [];
  for (let y = 150; y < 1150; y += 28) lines.push([80, y, 80 + 300 + Math.floor(rnd() * 390)]);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const z = inv[6] * x + inv[7] * y + inv[8];
      const u = (inv[0] * x + inv[1] * y + inv[2]) / z;
      const v = (inv[3] * x + inv[4] * y + inv[5]) / z;
      let rgb: [number, number, number];
      if (u >= 0 && v >= 0 && u < DW && v < DH) {
        rgb = [245, 244, 240];
        if (lines.some(([x0, y0, x1]) => v >= y0 && v < y0 + 9 && u >= x0 && u < x1)) rgb = [40, 40, 40];
        if (opts.dark?.some(([x0, y0, x1, y1]) => u >= x0 && u < x1 && v >= y0 && v < y1)) rgb = [30, 40, 70];
      } else rgb = opts.bg(x, y);
      const light = 1 - (opts.shade ?? 0) * (x / W);
      const tint = opts.tint ?? [1, 1, 1];
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = rgb[k] * light * tint[k] + (rnd() - 0.5) * 8;
      data[i + 3] = 255;
    }
  return { data, width: W, height: H };
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

const wood = (base: [number, number, number] = [150, 110, 75]) => (x: number, y: number): [number, number, number] => {
  const s = Math.sin(x / 9 + Math.sin(y / 80) * 3) * 14;
  return [base[0] + s, base[1] + s, base[2] + s];
};
const Q: Quad = [{ x: 160, y: 190 }, { x: 750, y: 220 }, { x: 790, y: 1030 }, { x: 120, y: 1000 }];

const close = (found: Quad | null, expected: Quad) => {
  expect(found).not.toBeNull();
  const err = Math.max(...found!.map((p, i) => Math.hypot(p.x - expected[i].x, p.y - expected[i].y)));
  expect(err).toBeLessThan(25);
};

describe("détection de la feuille sur des photos simulées", () => {
  it("feuille sur du bois", () => close(detectDocument(scene({ quad: Q, bg: wood() }), 320), Q));
  it("ombre sur la moitié de la photo", () => close(detectDocument(scene({ quad: Q, bg: wood(), shade: 0.45 }), 320), Q));
  it("bandeau et photo sombres sur la feuille", () =>
    close(detectDocument(scene({ quad: Q, bg: wood(), dark: [[0, 0, 850, 380], [450, 500, 800, 900]] }), 320), Q));
  it("table claire", () => close(detectDocument(scene({ quad: Q, bg: () => [200, 200, 195] }), 320), Q));
  it("feuille qui touche le bord", () => {
    const q: Quad = [{ x: 25, y: 0 }, { x: 880, y: 30 }, { x: 860, y: 1200 }, { x: 45, y: 1170 }];
    close(detectDocument(scene({ quad: q, bg: wood() }), 320), q);
  });
  it("fond très chargé (damier)", () =>
    close(detectDocument(scene({ quad: Q, bg: (x, y) => ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [60, 60, 70] : [120, 90, 60]) }), 320), Q));
  it("pas de feuille : rien n'est inventé", () => {
    const img = scene({ quad: [{ x: -10, y: -10 }, { x: -5, y: -10 }, { x: -5, y: -5 }, { x: -10, y: -5 }], bg: wood() });
    expect(detectDocument(img, 320)).toBeNull();
  });
  it("lumière chaude", () => close(detectDocument(scene({ quad: Q, bg: wood([170, 120, 70]), tint: [1, 0.88, 0.68] }), 320), Q));
});
