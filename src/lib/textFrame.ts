import { addScaled, screenAxes } from "./geometry";
import type { Point, TextAnnotation } from "./types";

/**
 * Cadre d'un texte et rotation propre (outil Pivoter) : le texte tourne de
 * `angle` degrés (sens horaire à l'écran) autour d'un pivot fixe, le centre
 * du cadre au moment de la rotation. Le pivot ne bouge pas pendant la saisie :
 * le texte s'allonge le long de son axe sans sauter.
 */

/** Hauteur de la ligne de base sous le haut du cadre, en corps de police. */
export const TEXT_ASCENT = 0.8;

/** Rotation d'un point autour d'un centre, sens trigonométrique (repère PDF, y vers le haut). */
function turn(p: Point, c: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(r) - y * Math.sin(r), c[1] + x * Math.sin(r) + y * Math.cos(r)];
}

/** Point de la page → même point dans le repère du texte non tourné. */
export function unrotateText(a: Pick<TextAnnotation, "angle" | "pivot" | "origin">, p: Point): Point {
  if (!a.angle) return p;
  // Sens horaire à l'écran = sens trigonométrique inverse dans le repère PDF : on annule par +angle.
  return turn(p, a.pivot ?? a.origin, a.angle);
}

/** Point du texte non tourné → position réelle sur la page. */
export function rotateText(a: Pick<TextAnnotation, "angle" | "pivot" | "origin">, p: Point): Point {
  return a.angle ? turn(p, a.pivot ?? a.origin, -a.angle) : p;
}

/** Centre du cadre (largeur et nombre de lignes connus), repère du texte non tourné. */
export function frameCenter(a: Pick<TextAnnotation, "origin" | "rotation" | "fontSize">, width: number, height: number): Point {
  const { right, down } = screenAxes(a.rotation);
  return addScaled(addScaled(a.origin, right, width / 2), down, height / 2 - a.fontSize * TEXT_ASCENT);
}

/** Coordonnée le long de la ligne (depuis l'origine) d'un point de la page. */
export function alongLine(a: Pick<TextAnnotation, "angle" | "pivot" | "origin" | "rotation">, p: Point): number {
  const q = unrotateText(a, p);
  const { right } = screenAxes(a.rotation);
  return (q[0] - a.origin[0]) * right[0] + (q[1] - a.origin[1]) * right[1];
}

/** Nouvel angle (normalisé entre -180 et 180), avec le pivot à utiliser. */
export function withAngle(a: TextAnnotation, angle: number, center: Point): TextAnnotation {
  let deg = ((Math.round(angle) % 360) + 360) % 360;
  if (deg > 180) deg -= 360;
  // Premier pivotement : autour du centre du cadre. Ensuite, toujours le même pivot.
  const pivot = a.angle ? (a.pivot ?? a.origin) : center;
  const { angle: _old, ...rest } = a;
  return deg ? { ...rest, angle: deg, pivot } : { ...rest, pivot };
}
