import type { ImageEncoder } from "./compress";

/**
 * Encodeur JPEG du navigateur pour la compression : décode l'image (JPEG ou
 * pixels bruts), la redimensionne sur un canvas et la réencode en JPEG.
 */
export const canvasEncoder: ImageEncoder = async (src, width, height, quality) => {
  // Les JPEG d'un PDF n'ont ni orientation EXIF ni profil à appliquer : valeurs brutes.
  const options: ImageBitmapOptions = { imageOrientation: "none", colorSpaceConversion: "none", premultiplyAlpha: "none" };
  let bitmap: ImageBitmap;
  if ("jpeg" in src) {
    bitmap = await createImageBitmap(new Blob([src.jpeg as BlobPart], { type: "image/jpeg" }), options);
  } else {
    const { pixels, width: w, height: h, channels } = src;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += channels) {
      const r = pixels[j];
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = channels === 3 ? pixels[j + 1] : r;
      rgba[i * 4 + 2] = channels === 3 ? pixels[j + 2] : r;
      rgba[i * 4 + 3] = 255;
    }
    bitmap = await createImageBitmap(new ImageData(rgba, w, h), options);
  }
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob =
      canvas instanceof HTMLCanvasElement
        ? await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality))
        : await canvas.convertToBlob({ type: "image/jpeg", quality });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    bitmap.close();
  }
};
