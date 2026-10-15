import type { Annotation, Tool } from "../lib/types";
import { missingChars } from "../lib/embeddedFonts";
import type { ToolStyle } from "./PageView";
import { FontPicker } from "./FontPicker";
import { Icon } from "./Icon";

const COLORS = ["#000000", "#ffffff", "#e5484d", "#f76b15", "#ffe14d", "#30a46c", "#0090ff", "#1a2b6d", "#8e4ec6"];

interface Props {
  tool: Tool;
  style: ToolStyle;
  selected: Annotation | null;
  onStyle: (patch: Partial<ToolStyle>) => void;
  onUpdate: (a: Annotation, commit: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onError: (msg: string) => void;
}

export function PropertiesPanel({ tool, style, selected, onStyle, onUpdate, onDelete, onDuplicate, onError }: Props) {
  // Modifie l'annotation sélectionnée, et retient le réglage pour les suivantes.
  const set = (patch: Partial<ToolStyle> & { text?: string }, commit = true) => {
    const { text, ...stylePatch } = patch;
    if (Object.keys(stylePatch).length) onStyle(stylePatch);
    if (selected) {
      const next = { ...selected } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (k in selected) next[k] = v;
      if (text !== undefined) next.text = text;
      // Choisir une autre police abandonne la police incorporée d'origine.
      if (patch.fontKey !== undefined) delete next.embedded;
      onUpdate(next as unknown as Annotation, commit);
    }
  };

  const kind = selected?.kind ?? tool;
  const v = {
    color: selected?.color ?? style.color,
    opacity: selected?.opacity ?? style.opacity,
    width: selected && "width" in selected ? selected.width : style.width,
    fill: selected && "fill" in selected ? selected.fill : style.fill,
    fontKey: selected?.kind === "text" ? selected.fontKey : style.fontKey,
    fontSize: selected?.kind === "text" ? selected.fontSize : style.fontSize,
  };

  const showColor = kind !== "image" && kind !== "whiteout" && kind !== "select" && kind !== "editText";
  const showWidth = ["ink", "line", "rect", "ellipse"].includes(kind);
  const showFill = kind === "rect" || kind === "ellipse";
  const showText = kind === "text" || kind === "editText";

  return (
    <div className="props-panel">
      <h3>{selected ? "Élément sélectionné" : "Réglages de l'outil"}</h3>

      {selected?.kind === "text" && (
        <label className="field">
          Texte
          <textarea
            rows={3}
            value={selected.text}
            onChange={(e) => set({ text: e.target.value }, false)}
            onBlur={(e) => set({ text: e.target.value }, true)}
          />
        </label>
      )}

      {selected?.kind === "text" && selected.embedded && (() => {
        const missing = missingChars(selected.embedded, selected.text);
        const name = selected.embedded.baseFont.replace(/^[A-Z]{6}\+/, "");
        return missing.length === 0 ? (
          <p className="font-status ok">
            Police d'origine du PDF : <strong>{name}</strong> (incorporée, rendu identique).
          </p>
        ) : (
          <p className="font-status warn">
            Caractère(s) absent(s) de la police d'origine <strong>{name}</strong> : « {missing.join(" ")} ». Le texte
            utilise la police de remplacement ci-dessous ; retirez ces caractères pour retrouver la police d'origine.
          </p>
        );
      })()}

      {showText && (
        <>
          <div className="field">
            {selected?.kind === "text" && selected.embedded ? "Police de remplacement" : "Police"}
            <FontPicker value={v.fontKey} onChange={(fontKey) => set({ fontKey })} onError={onError} />
          </div>
          <label className="field">
            Taille : {Math.round(v.fontSize * 10) / 10} pt
            <input type="range" min={4} max={96} step={0.5} value={v.fontSize} onChange={(e) => set({ fontSize: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
          </label>
        </>
      )}

      {showColor && (
        <div className="field">
          Couleur
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} className={`swatch ${c === v.color ? "active" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
            ))}
            <input type="color" value={v.color} onChange={(e) => set({ color: e.target.value })} aria-label="Couleur personnalisée" />
          </div>
        </div>
      )}

      {showWidth && (
        <label className="field">
          Épaisseur : {v.width} pt
          <input type="range" min={0.5} max={20} step={0.5} value={v.width} onChange={(e) => set({ width: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
        </label>
      )}

      {showFill && (
        <label className="field inline">
          <input type="checkbox" checked={v.fill} onChange={(e) => set({ fill: e.target.checked })} /> Forme pleine
        </label>
      )}

      {kind !== "select" && kind !== "editText" && kind !== "whiteout" && (
        <label className="field">
          Opacité : {Math.round(v.opacity * 100)} %
          <input type="range" min={0.1} max={1} step={0.05} value={v.opacity} onChange={(e) => set({ opacity: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
        </label>
      )}

      {tool === "editText" && !selected && (
        <p className="hint">
          Touchez un texte du PDF : il est masqué et remplacé par un texte modifiable, dans la police d'origine si elle est
          disponible sur cet appareil.
        </p>
      )}
      {tool === "select" && !selected && <p className="hint">Touchez un élément ajouté pour le déplacer, le redimensionner ou le modifier.</p>}

      {selected && (
        <div className="panel-actions">
          <button onClick={onDuplicate}>
            <Icon name="copy" /> Dupliquer
          </button>
          <button className="danger" onClick={onDelete}>
            <Icon name="trash" /> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
