import { describe, expect, it } from "vitest";
import { SAVE_FORMATS, imageNames } from "./imageExport";

describe("enregistrement d'un scan en images", () => {
  it("PDF proposé en premier", () => expect(SAVE_FORMATS.map((f) => f.id)).toEqual(["pdf", "avif", "webp", "heic", "png", "jpg"]));
  it("une page : le nom tel quel", () => expect(imageNames("Scan_2026-11-24.pdf", 1, "jpg")).toEqual(["Scan_2026-11-24.jpg"]));
  it("plusieurs pages : un fichier numéroté par page", () =>
    expect(imageNames("Scan 2026-11-24.pdf", 3, "avif")).toEqual(["Scan 2026-11-24-1.avif", "Scan 2026-11-24-2.avif", "Scan 2026-11-24-3.avif"]));
});
