// Génère les icônes PNG de l'application (sans dépendance) : une feuille
// blanche aux lignes de texte sur fond rouge arrondi.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const RED = [217, 58, 63];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function draw(size, maskable) {
  const s = size / 100;
  // Zone de sécurité réduite pour les icônes « maskable » (Android découpe en cercle).
  const k = maskable ? 0.72 : 1;
  const off = (100 - 100 * k) / 2;
  const P = (v) => (off + v * k) * s;
  return png(size, (x, y) => {
    const bg = maskable || inRoundRect(x, y, 0, 0, size, size, 22 * s);
    if (!bg) return [0, 0, 0, 0];
    const sheet = inRoundRect(x, y, P(24), P(14), P(76), P(86), 6 * s * k);
    if (!sheet) return [...RED, 255];
    const lines = [
      [34, 32, 66],
      [34, 44, 66],
      [34, 56, 66],
      [34, 68, 54],
    ];
    for (const [x0, ly, x1] of lines) {
      if (inRoundRect(x, y, P(x0), P(ly - 2.5), P(x1), P(ly + 2.5), 2.5 * s * k)) return [...RED, 255];
    }
    return [...WHITE, 255];
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", draw(192, false));
writeFileSync("public/icons/icon-512.png", draw(512, false));
writeFileSync("public/icons/icon-maskable-512.png", draw(512, true));
writeFileSync("public/icons/apple-touch-icon.png", draw(180, true));
console.log("Icônes générées dans public/icons");
