import type { EmbeddedFont } from "./embeddedFonts";
import type { ShapeId } from "./shapes";

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
  | "arrow"
  | "whiteout"
  | "stamp"
  | "field"
  | "shape"
  | "eraser"
  | "image";

export type FieldType = "text" | "checkbox" | "dropdown";

interface AnnotationBase {
  id: string;
  /** Identifiant stable de la page (survit aux réorganisations). */
  pageId: string;
  color: string;
  opacity: number;
  /** Rotation propre (degrés, sens horaire à l'écran) autour du centre : formes, images. */
  angle?: number;
}

export interface InkAnnotation extends AnnotationBase {
  kind: "ink";
  points: Point[];
  width: number;
}

/** Ligne de texte d'origine du PDF : départ de la ligne de base, direction, longueur, taille. */
export interface TextLine {
  origin: Point;
  /** Degrés, sens trigonométrique dans l'espace PDF (0 = horizontal). */
  angle: number;
  width: number;
  fontSize: number;
}

export interface ShapeAnnotation extends AnnotationBase {
  kind: "rect" | "ellipse" | "highlight" | "whiteout";
  rect: Rect;
  /** Épaisseur du contour ; 0 = forme pleine. */
  width: number;
  fill: boolean;
  /**
   * Cache posé par « Modifier le texte » : à l'enregistrement, le texte d'origine
   * sous cette zone est réellement retiré du fichier. Le cache n'est dessiné que
   * si ce retrait est impossible (texte dans une image scannée, police non prise en charge).
   * Sans ce champ (cache blanc dessiné à la main), le texte sous le cache est aussi
   * retiré du fichier, et le cache reste dessiné.
   */
  removeText?: TextLine;
  /** Texte de remplacement auquel appartient ce cache (« Modifier le texte »). */
  owner?: string;
}

export interface LineAnnotation extends AnnotationBase {
  kind: "line";
  from: Point;
  to: Point;
  width: number;
  /** Pointe de flèche à l'extrémité `to`. */
  arrow?: boolean;
  /** Pointe de flèche aussi au départ `from` (double flèche). */
  arrowStart?: boolean;
  /** Point de contrôle (courbe de Bézier quadratique) : trait ou flèche courbe. */
  control?: Point;
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
  underline?: boolean;
  /** Texte barré. */
  strike?: boolean;
  /** Surlignage : couleur de fond derrière chaque ligne. */
  highlight?: string;
  /**
   * Bloc de texte (paragraphe, titre sur plusieurs lignes) : le texte est remis en
   * page dans cette largeur, avec cet alignement et cet interligne (points).
   */
  box?: { width: number; align: "left" | "center" | "right" | "justify"; lineHeight: number };
  /** Police d'origine du texte modifié (pour retrouver la vraie police plus tard). */
  originalFont?: { name: string; bold?: boolean; italic?: boolean };
  /**
   * Police incorporée d'origine (« Modifier le texte »). Utilisée tant que tous
   * les caractères du texte existent dans le sous-ensemble incorporé ; sinon
   * `fontKey` sert de police de remplacement.
   */
  embedded?: EmbeddedFont;
}

/** Forme de la bibliothèque (triangle, étoile, flèche pleine…), tracé vectoriel. */
export interface PathShapeAnnotation extends AnnotationBase {
  kind: "shape";
  shape: ShapeId;
  rect: Rect;
  width: number;
  fill: boolean;
  /** Rotation de la page à la création : la forme garde son orientation à l'écran. */
  rotation: number;
}

/** Champ de formulaire à créer (devient un vrai champ PDF à l'enregistrement). */
export interface FieldAnnotation extends AnnotationBase {
  kind: "field";
  rect: Rect;
  fieldType: FieldType;
  /** Nom du champ (unique dans le document). */
  name: string;
  /** Choix proposés (liste déroulante). */
  options?: string[];
  multiline?: boolean;
  /** Taille du texte saisi (0 = automatique). */
  fontSize: number;
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
  | PathShapeAnnotation
  | FieldAnnotation
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
  /** Document créé par la numérisation (date proposée dans le nom par défaut). */
  scan?: boolean;
  /** Dernier nom choisi à l'enregistrement (sans date) et sa date. */
  fileBase?: string;
  fileDate?: string | null;
}

let counter = 0;
export function newId(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
