import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportPdf } from "./exportPdf";
import { registerFontBytes } from "./fonts";
import type { Annotation } from "./types";

// Vérifie l'intégration de vraies polices installées (TTF et collections TTC)
// avec des alphabets non latins. Ignoré si les polices ne sont pas présentes.
const candidates = {
  ttf: ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial Unicode.ttf"],
  ttc: ["C:/Windows/Fonts/msgothic.ttc", "C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"],
};
const find = (list: string[]) => list.find((p) => existsSync(p));
const ttf = find(candidates.ttf);
const ttc = find(candidates.ttc);

async function blank(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return d.save();
}

function text(fontKey: string, value: string): Annotation {
  return { id: "t", pageId: "p", kind: "text", origin: [50, 700], text: value, fontKey, fontSize: 14, color: "#000000", opacity: 1, rotation: 0 };
}

const toBuffer = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("polices installées", () => {
  it.skipIf(!ttf)("intègre une police TTF avec cyrillique, grec et latin étendu", async () => {
    const key = registerFontBytes("systeme-ttf", toBuffer(ttf!));
    const out = await exportPdf(await blank(), ["p"], [text(key, "Привет мир — Γειά σου — Zażółć gęślą jaźń — Ærøskøbing")]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it.skipIf(!ttc)("intègre une police d'une collection TTC (chinois / japonais)", async () => {
    const key = registerFontBytes("systeme-ttc", toBuffer(ttc!));
    const out = await exportPdf(await blank(), ["p"], [text(key, "日本語のテキスト 中文文本")]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
