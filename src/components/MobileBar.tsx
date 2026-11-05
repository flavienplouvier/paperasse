import { useState } from "react";
import type { Annotation, Tool } from "../lib/types";
import type { FileFont } from "../lib/fileFonts";
import { getFont, styleVariant } from "../lib/fonts";
import type { ToolStyle } from "./PageView";
import { COLORS, applyStyle, currentStyle } from "./PropertiesPanel";
import { FontPicker, useFonts } from "./FontPicker";
import { Icon } from "./Icon";

/**
 * Barre d'outils du téléphone, en bas de l'écran, qui change selon le choix :
 *  1. accueil : les familles d'outils (Texte, Dessin, Signer, Masquer, Remplir) ;
 *  2. famille : ← et ses outils ;
 *  3. outil (ou élément sélectionné) : ← et ses réglages directement dans la barre,
 *     les plus fins dans un petit volet (couleur, taille, police, opacité).
 */

type Action = "sign" | "image" | "forms";
interface ToolDef {
  id: string;
  label: string;
  icon: string;
  tool?: Tool;
  action?: Action;
  /** Outils couverts par ce bouton (formes : forme, rectangle, ellipse). */
  covers?: Tool[];
  hint?: string;
  style?: Partial<ToolStyle>;
}
interface Category {
  id: string;
  label: string;
  icon: string;
  tools: ToolDef[];
}

export const CATEGORIES: Category[] = [
  {
    id: "texte",
    label: "Texte",
    icon: "text",
    tools: [
      { id: "editText", label: "Modifier", icon: "editText", tool: "editText", hint: "Touchez une ligne du document pour la modifier" },
      { id: "text", label: "Ajouter", icon: "text", tool: "text", hint: "Touchez la page à l'endroit où écrire" },
    ],
  },
  {
    id: "dessin",
    label: "Dessin",
    icon: "ink",
    tools: [
      { id: "ink", label: "Stylo", icon: "pen", tool: "ink" },
      { id: "highlight", label: "Surligner", icon: "highlight", tool: "highlight" },
      { id: "line", label: "Trait", icon: "line", tool: "line" },
      { id: "arrow", label: "Flèche", icon: "arrow", tool: "arrow" },
      { id: "shape", label: "Formes", icon: "shapes", tool: "shape", covers: ["shape", "rect", "ellipse"] },
    ],
  },
  {
    id: "signer",
    label: "Signer",
    icon: "sign",
    tools: [
      { id: "sign", label: "Signature", icon: "sign", action: "sign" },
      { id: "stamp", label: "Tampon", icon: "stamp", tool: "stamp", hint: "Choisissez un tampon, puis touchez la page" },
      { id: "image", label: "Image", icon: "image", action: "image" },
    ],
  },
  {
    id: "masquer",
    label: "Masquer",
    icon: "whiteout",
    tools: [
      { id: "whiteout", label: "Cache", icon: "whiteout", tool: "whiteout", hint: "Tracez un rectangle : le texte dessous est supprimé" },
      { id: "eraser", label: "Gomme", icon: "eraser", tool: "eraser", hint: "Touchez un élément ajouté pour l'effacer" },
    ],
  },
  {
    id: "remplir",
    label: "Remplir",
    icon: "form",
    tools: [
      { id: "forms", label: "Remplir", icon: "form", action: "forms" },
      { id: "field", label: "Créer", icon: "plus", tool: "field", hint: "Tracez la zone du nouveau champ" },
    ],
  },
];

const KIND_ICON: Partial<Record<Annotation["kind"], string>> = {
  text: "text",
  ink: "pen",
  highlight: "highlight",
  line: "line",
  rect: "rect",
  ellipse: "ellipse",
  shape: "shapes",
  whiteout: "whiteout",
  image: "image",
  field: "form",
};

type Sheet = "color" | "size" | "font" | "opacity" | null;

interface Props {
  tool: Tool;
  style: ToolStyle;
  selected: Annotation | null;
  editable: boolean;
  /** Placement d'une image, d'une signature ou d'un tampon en attente. */
  placing: boolean;
  onTool: (tool: Tool) => void;
  onStyle: (patch: Partial<ToolStyle>) => void;
  onUpdate: (a: Annotation, commit: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDeselect: () => void;
  onAction: (action: Action) => void;
  /** Ouvre le panneau de réglages complet (en volet). */
  onSettings: () => void;
  onError: (msg: string) => void;
  pickedColors: string[];
  onPickColor: () => Promise<string | null>;
  fileFonts: FileFont[];
}

interface Item {
  key: string;
  label: string;
  icon?: string;
  swatch?: string;
  glyph?: string;
  glyphStyle?: React.CSSProperties;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function MobileBar(props: Props) {
  const { tool, style, selected, editable, onTool, onStyle, onUpdate } = props;
  useFonts();
  const [cat, setCat] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const set = (patch: Partial<ToolStyle>, commit = true) => applyStyle(patch, selected, onStyle, onUpdate, commit);
  const v = currentStyle(selected, style);
  const toggle = (s: Sheet) => setSheet((cur) => (cur === s ? null : s));

  const owner = CATEGORIES.find((c) => c.tools.some((t) => t.tool === tool || t.covers?.includes(tool)));
  const def = owner?.tools.find((t) => t.tool === tool || t.covers?.includes(tool));
  const level: "home" | "cat" | "tool" | "selection" =
    selected && (tool === "select" || selected.kind === "text") ? "selection" : tool !== "select" || props.placing ? "tool" : cat ? "cat" : "home";
  const kind = level === "selection" ? selected!.kind : tool;
  const isText = kind === "text" || kind === "editText";

  // ---------------------------------------------------------------- réglages
  const font = getFont(v.fontKey);
  const boldKey = styleVariant(v.fontKey, !font.bold, !!font.italic);
  const italicKey = styleVariant(v.fontKey, !!font.bold, !font.italic);
  const colorItem: Item = { key: "color", label: "Couleur", swatch: v.color, active: sheet === "color", onClick: () => toggle("color") };
  const sizeItem: Item = isText
    ? { key: "size", label: "Taille", glyph: `${Math.round(v.fontSize)}`, active: sheet === "size", onClick: () => toggle("size") }
    : { key: "size", label: "Épaisseur", glyph: `${v.width}`, active: sheet === "size", onClick: () => toggle("size") };
  const more: Item = { key: "more", label: "Réglages", icon: "props", onClick: () => (setSheet(null), props.onSettings()) };
  const textItems: Item[] = [
    { key: "font", label: "Police", glyph: "Aa", glyphStyle: { fontFamily: font.cssFamily }, active: sheet === "font", onClick: () => toggle("font") },
    sizeItem,
    colorItem,
    { key: "bold", label: "Gras", glyph: "G", glyphStyle: { fontWeight: 800 }, active: !!font.bold, disabled: !boldKey, onClick: () => boldKey && set({ fontKey: boldKey }) },
    { key: "italic", label: "Italique", glyph: "I", glyphStyle: { fontStyle: "italic", fontFamily: "Georgia, serif" }, active: !!font.italic, disabled: !italicKey, onClick: () => italicKey && set({ fontKey: italicKey }) },
    { key: "underline", label: "Souligné", glyph: "S", glyphStyle: { textDecoration: "underline" }, active: v.underline, onClick: () => set({ underline: !v.underline }) },
  ];
  const settings = (k: Tool | Annotation["kind"]): Item[] => {
    switch (k) {
      case "editText":
      case "text":
        return textItems;
      case "ink":
        return [colorItem, sizeItem, { key: "opacity", label: "Opacité", glyph: `${Math.round(v.opacity * 100)}`, active: sheet === "opacity", onClick: () => toggle("opacity") }];
      case "highlight":
        return [colorItem, sizeItem];
      case "line":
        return [colorItem, sizeItem];
      case "arrow":
        return [colorItem, sizeItem, { key: "double", label: "Double", icon: "doubleArrow", active: style.doubleArrow, onClick: () => onStyle({ doubleArrow: !style.doubleArrow }) }];
      case "shape":
      case "rect":
      case "ellipse":
        return [
          { key: "pick", label: "Forme", icon: "shapes", onClick: props.onSettings },
          colorItem,
          { key: "fill", label: v.fill ? "Plein" : "Contour", glyph: v.fill ? "■" : "□", active: v.fill, onClick: () => set({ fill: !v.fill }) },
          sizeItem,
        ];
      case "stamp":
        return [{ key: "pick", label: "Choisir", icon: "stamp", onClick: props.onSettings }];
      case "field":
        return [{ key: "pick", label: "Type", icon: "form", onClick: props.onSettings }];
      default:
        return [];
    }
  };

  // ---------------------------------------------------------------- contenu de la barre
  let back: (() => void) | null = null;
  let items: Item[];
  if (level === "selection") {
    back = props.onDeselect;
    const s = selected!;
    items = [
      { key: "kind", label: "Sélection", icon: KIND_ICON[s.kind] ?? "select", active: true, onClick: () => undefined },
      ...settings(s.kind).filter((i) => i.key !== "pick"),
      { key: "dup", label: "Dupliquer", icon: "copy", onClick: props.onDuplicate },
      { key: "del", label: "Supprimer", icon: "trash", onClick: props.onDelete },
    ];
  } else if (level === "tool") {
    back = () => {
      setSheet(null);
      if (owner) setCat(owner.id);
      onTool("select");
    };
    items = [
      { key: "tool", label: def?.label ?? (props.placing ? "Placer" : "Outil"), icon: def?.icon ?? "image", active: true, onClick: back },
      ...settings(tool),
      ...(settings(tool).length && !["stamp", "field", "shape", "rect", "ellipse"].includes(tool) ? [more] : []),
    ];
  } else if (level === "cat") {
    back = () => setCat(null);
    const c = CATEGORIES.find((x) => x.id === cat)!;
    items = c.tools.map((t) => ({
      key: t.id,
      label: t.label,
      icon: t.icon,
      disabled: !editable,
      onClick: () => {
        setSheet(null);
        if (t.action) props.onAction(t.action);
        else if (t.tool) {
          onTool(t.tool);
          if (t.tool === "stamp") props.onSettings();
        }
      },
    }));
  } else {
    items = CATEGORIES.map((c) => ({ key: c.id, label: c.label, icon: c.icon, disabled: !editable, onClick: () => setCat(c.id) }));
  }
  const hint = level === "tool" && !sheet ? (props.placing ? "Touchez la page pour placer l'élément" : def?.hint) : undefined;

  return (
    <>
      {hint && <div className="mobile-hint mobile-only">{hint}</div>}
      {sheet && (
        <div className="msheet mobile-only" role="dialog" aria-label="Réglage">
          <div className="msheet-handle" />
          {sheet === "color" && (
            <div className="msheet-colors">
              <div className="swatches">
                {COLORS.map((c) => (
                  <button key={c} className={`swatch ${c === v.color ? "active" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
                ))}
                <input type="color" value={v.color} onChange={(e) => set({ color: e.target.value })} aria-label="Couleur personnalisée" />
                <button
                  className="swatch-tool"
                  aria-label="Pipette"
                  title="Pipette : copier une couleur de la page"
                  onClick={async () => {
                    setSheet(null);
                    const c = await props.onPickColor();
                    if (c) set({ color: c });
                  }}
                >
                  <Icon name="pipette" />
                </button>
              </div>
              {props.pickedColors.length > 0 && (
                <div className="swatches">
                  {props.pickedColors.map((c) => (
                    <button key={c} className={`swatch ${c === v.color ? "active" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} title={c} />
                  ))}
                </div>
              )}
            </div>
          )}
          {sheet === "size" &&
            (isText ? (
              <label className="field">
                Taille : {Math.round(v.fontSize * 10) / 10} pt
                <input type="range" min={4} max={96} step={0.5} value={v.fontSize} onChange={(e) => set({ fontSize: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
              </label>
            ) : (
              <label className="field">
                Épaisseur : {v.width} pt
                <input type="range" min={0.5} max={kind === "highlight" ? 40 : 20} step={0.5} value={v.width} onChange={(e) => set({ width: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
              </label>
            ))}
          {sheet === "opacity" && (
            <label className="field">
              Opacité : {Math.round(v.opacity * 100)} %
              <input type="range" min={0.1} max={1} step={0.05} value={v.opacity} onChange={(e) => set({ opacity: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
            </label>
          )}
          {sheet === "font" && (
            <FontPicker value={v.fontKey} onChange={(fontKey) => set({ fontKey })} onError={props.onError} fileFonts={props.fileFonts} />
          )}
        </div>
      )}
      <nav className="mbar mobile-only" aria-label="Outils">
        {back && (
          <button className="mbar-back" aria-label="Retour" title="Retour" onClick={back}>
            <Icon name="back" size={26} />
          </button>
        )}
        <div className="mbar-items">
          {items.map((i) => (
            <button key={i.key} className={`mbar-item ${i.active ? "active" : ""}`} disabled={i.disabled} onClick={i.onClick} aria-label={i.label} aria-pressed={i.active}>
              {i.icon && <Icon name={i.icon} />}
              {i.swatch && <span className="mbar-swatch" style={{ background: i.swatch }} />}
              {i.glyph && (
                <span className="mbar-glyph" style={i.glyphStyle}>
                  {i.glyph}
                </span>
              )}
              <span className="mbar-label">{i.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
