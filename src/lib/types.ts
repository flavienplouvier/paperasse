/** Point dans l'espace utilisateur PDF (unités PDF, axe Y vers le haut). */
export type Point = [number, number];

/** Rectangle normalisé dans l'espace utilisateur PDF : [x1, y1, x2, y2], x1<x2, y1<y2. */
export type Rect = [number, number, number, number];

export type Tool =
  | "select"
  | "editText"
  | "text"
  | "ink"
  | "highlight"
  | "rect"
  | "ellipse"
  | "line"
  | "whiteout"
  | "image";

interface AnnotationBase {
  id: string;
  /** Identifiant stable de la page (survit aux réorganisations). */
  pageId: string;
  color: string;
  opacity: number;
}

export interface InkAnnotation extends AnnotationBase {
  kind: "ink";
  points: Point[];
  width: number;
}

export interface ShapeAnnotation extends AnnotationBase {
  kind: "rect" | "ellipse" | "highlight" | "whiteout";
  rect: Rect;
  /** Épaisseur du contour ; 0 = forme pleine. */
  width: number;
  fill: boolean;
}

export interface LineAnnotation extends AnnotationBase {
  kind: "line";
  from: Point;
  to: Point;
  width: number;
}

export interface TextAnnotation extends AnnotationBase {
  kind: "text";
  /** Origine de la ligne de base de la première ligne. */
  origin: Point;
  text: string;
  fontKey: string;
  fontSize: number;
  /** Rotation de la page (degrés, sens horaire) au moment de la création. */
  rotation: number;
}

export interface ImageAnnotation extends AnnotationBase {
  kind: "image";
  rect: Rect;
  /** data:image/png ou data:image/jpeg */
  dataUrl: string;
}

export type Annotation =
  | InkAnnotation
  | ShapeAnnotation
  | LineAnnotation
  | TextAnnotation
  | ImageAnnotation;

export interface DocState {
  name: string;
  bytes: Uint8Array;
  /** Un identifiant par page, dans l'ordre des pages de `bytes`. */
  pageIds: string[];
  annotations: Annotation[];
  /**
   * false si pdf-lib ne peut pas réécrire le fichier (PDF chiffré ou très abîmé) :
   * l'affichage et les annotations restent possibles, l'export passe par un rendu en images.
   */
  rewritable: boolean;
  password?: string;
}

let counter = 0;
export function newId(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
