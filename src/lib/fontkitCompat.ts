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
    let font = fontkit.create(data, postscriptName ?? preferred) as AnyFont;
    if (font && Array.isArray(font.fonts)) font = font.fonts[0];
    padTrueTypeSubsets(font);
    return font;
  },
} as typeof fontkit;

type SubsetProto = {
  _addGlyph: (gid: number) => number;
  glyf: Uint8Array[];
  offset: number;
  __paperassePadded?: boolean;
};

/**
 * Correctif fontkit : dans un sous-ensemble TrueType, la table `loca` courte
 * stocke les positions des glyphes divisées par 2. Un glyphe de longueur
 * impaire décale alors tous les suivants : la police intégrée est corrompue et
 * reste invisible dans la plupart des lecteurs PDF (ex. Tinos Gras). On
 * complète chaque glyphe à une longueur paire, comme l'exige la spécification.
 */
function padTrueTypeSubsets(font: AnyFont | undefined) {
  const f = font as unknown as { createSubset?: () => object; directory?: { tables?: Record<string, unknown> } } | undefined;
  if (!f?.createSubset || !f.directory?.tables?.glyf) return;
  const proto = Object.getPrototypeOf(f.createSubset()) as SubsetProto;
  if (proto.__paperassePadded || typeof proto._addGlyph !== "function") return;
  const original = proto._addGlyph;
  proto._addGlyph = function (this: SubsetProto, gid: number) {
    const index = original.call(this, gid);
    const last = this.glyf[this.glyf.length - 1];
    if (last && last.length % 2) {
      const Ctor = last.constructor as { alloc?: (n: number) => Uint8Array };
      const padded = Ctor.alloc ? Ctor.alloc(last.length + 1) : new Uint8Array(last.length + 1);
      padded.set(last);
      this.glyf[this.glyf.length - 1] = padded;
      this.offset += 1;
    }
    return index;
  };
  proto.__paperassePadded = true;
}

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
