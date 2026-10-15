import fontkit from "@pdf-lib/fontkit";

/**
 * pdf-lib appelle `fontkit.create(octets)` sans nom de police. Pour une
 * collection (.ttc/.otc — fréquent pour les polices chinoises, japonaises et
 * coréennes de Windows et macOS), cela renvoie la collection entière, que
 * pdf-lib ne sait pas intégrer. Cet adaptateur sélectionne la police voulue
 * (par son nom PostScript) ou, à défaut, la première de la collection.
 */
let preferred: string | undefined;

type AnyFont = ReturnType<typeof fontkit.create> & { fonts?: AnyFont[] };

export const compatFontkit = {
  ...fontkit,
  create(data: Uint8Array, postscriptName?: string) {
    const font = fontkit.create(data, postscriptName ?? preferred) as AnyFont;
    if (font && Array.isArray(font.fonts)) return font.fonts[0];
    return font;
  },
} as typeof fontkit;

/** Exécute `fn` en indiquant quelle police choisir dans une éventuelle collection. */
export async function withPreferredFont<T>(postscriptName: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = preferred;
  preferred = postscriptName;
  try {
    return await fn();
  } finally {
    preferred = previous;
  }
}
