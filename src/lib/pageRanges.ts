/**
 * Pages à enregistrer, écrites comme dans la fenêtre d'impression :
 * « 1,3 » (pages 1 et 3), « 1-3 » (pages 1 à 3), « 1-3, 6, 8- » (8 jusqu'à la fin),
 * « -2 » (du début à la page 2). Les pages sont gardées dans l'ordre du document,
 * sans doublon, comme pour une imprimante.
 *
 * Renvoie les numéros de page (à partir de 1), ou null si la saisie est invalide
 * (page inexistante, intervalle à l'envers, caractère inattendu, aucune page).
 */
export function parsePageRanges(text: string, total: number): number[] | null {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const pages = new Set<number>();
  for (const part of parts) {
    const m = /^(\d*)\s*[-–—]\s*(\d*)$/.exec(part);
    let from: number;
    let to: number;
    if (m) {
      if (!m[1] && !m[2]) return null;
      from = m[1] ? Number(m[1]) : 1;
      to = m[2] ? Number(m[2]) : total;
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part);
    } else return null;
    if (from < 1 || to > total || from > to) return null;
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}
