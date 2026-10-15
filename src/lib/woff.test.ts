import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportPdf } from "./exportPdf";
import { registerFontBytes } from "./fonts";

/** Convertit une police TrueType en WOFF 1.0 (tables compressées zlib). */
function ttfToWoff(ttf: Uint8Array): Uint8Array {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = view.getUint16(4);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const rec = 12 + i * 16;
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    const data = ttf.subarray(offset, offset + length);
    const packed = deflateSync(data);
    return {
      tag: view.getUint32(rec),
      checksum: view.getUint32(rec + 4),
      length,
      data: packed.length < length ? new Uint8Array(packed) : data,
    };
  });
  const pad = (n: number) => (n + 3) & ~3;
  let offset = 44 + numTables * 20;
  const total = tables.reduce((n, t) => n + pad(t.data.length), offset);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x774f4646); // « wOFF »
  dv.setUint32(4, view.getUint32(0));
  dv.setUint32(8, total);
  dv.setUint16(12, numTables);
  dv.setUint32(16, 12 + numTables * 16 + tables.reduce((n, t) => n + pad(t.length), 0));
  dv.setUint16(20, 1);
  tables.forEach((t, i) => {
    const rec = 44 + i * 20;
    dv.setUint32(rec, t.tag);
    dv.setUint32(rec + 4, offset);
    dv.setUint32(rec + 8, t.data.length);
    dv.setUint32(rec + 12, t.length);
    dv.setUint32(rec + 16, t.checksum);
    out.set(t.data, offset);
    offset += pad(t.data.length);
  });
  return out;
}

describe("import de polices WOFF", () => {
  it("intègre une police WOFF importée dans le PDF exporté", async () => {
    const require = createRequire(import.meta.url);
    const dir = dirname(require.resolve("@expo-google-fonts/carlito/package.json"));
    const ttf = new Uint8Array(readFileSync(join(dir, "400Regular", "Carlito_400Regular.ttf")));
    const woff = ttfToWoff(ttf);
    expect(new TextDecoder().decode(woff.subarray(0, 4))).toBe("wOFF");
    expect(woff.length).toBeLessThan(ttf.length);

    const key = registerFontBytes("Carlito-woff", woff.buffer.slice(woff.byteOffset, woff.byteOffset + woff.byteLength) as ArrayBuffer);
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    const out = await exportPdf(await d.save(), ["p"], [
      { id: "t", pageId: "p", kind: "text", origin: [50, 700], text: "Police WOFF : déjà prête", fontKey: key, fontSize: 14, color: "#000000", opacity: 1, rotation: 0 },
    ]);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const text = ((await (await pdf.getPage(1)).getTextContent()).items as { str: string }[]).map((i) => i.str).join("");
    expect(text).toContain("Police WOFF : déjà prête");
  });
});
