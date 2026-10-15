import { useState } from "react";
import type { Annotation, FieldAnnotation, FieldType, Tool } from "../lib/types";
import { missingChars } from "../lib/embeddedFonts";
import { getFont, styleVariant } from "../lib/fonts";
import { STAMPS, renderStamp } from "../lib/stamp";
import type { ToolStyle } from "./PageView";
import { FontPicker, useFonts } from "./FontPicker";
import { Icon } from "./Icon";

/** Choix d'un tampon prédéfini ou personnalisé, avec date facultative. */
function StampPicker({ onStamp }: { onStamp: (dataUrl: string) => void }) {
  const [custom, setCustom] = useState("");
  const [color, setColor] = useState("#c62828");
  const [withDate, setWithDate] = useState(true);
  return (
    <div className="stamp-picker">
      <div className="stamp-grid">
        {STAMPS.map((s) => (
          <button key={s.label} className="stamp-btn" style={{ color: s.color, borderColor: s.color }} onClick={() => onStamp(renderStamp(s.label, s.color, withDate))}>
            {s.label}
          </button>
        ))}
      </div>
      <label className="field inline">
        <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} /> Ajouter la date du jour
      </label>
      <div className="field">
        Tampon personnalisé
        <div className="search-row" style={{ padding: 0 }}>
          <input value={custom} placeholder="Ex. : Bon pour accord" onChange={(e) => setCustom(e.target.value)} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Couleur du tampon" />
          <button className="primary" disabled={!custom.trim()} onClick={() => onStamp(renderStamp(custom, color, withDate))}>
            OK
          </button>
        </div>
      </div>
      <p className="hint">Choisissez un tampon, puis touchez la page à l'endroit où le poser.</p>
    </div>
  );
}

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
  onStamp: (dataUrl: string) => void;
}

export function PropertiesPanel({ tool, style, selected, onStyle, onUpdate, onDelete, onDuplicate, onError, onStamp }: Props) {
  useFonts(); // re-rendu quand la bibliothèque de polices est chargée (boutons G / I)
  // Modifie l'annotation sélectionnée, et retient le réglage pour les suivantes.
  const set = (patch: Partial<ToolStyle> & { text?: string }, commit = true) => {
    const { text, ...stylePatch } = patch;
    if (Object.keys(stylePatch).length) onStyle(stylePatch);
    if (selected) {
      const next = { ...selected } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (k in selected || (k === "underline" && selected.kind === "text")) next[k] = v;
      }
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
    underline: selected?.kind === "text" ? !!selected.underline : style.underline,
  };
  const currentFont = getFont(v.fontKey);
  const boldKey = styleVariant(v.fontKey, !currentFont.bold, !!currentFont.italic);
  const italicKey = styleVariant(v.fontKey, !!currentFont.bold, !currentFont.italic);

  const showColor = !["image", "whiteout", "select", "editText", "stamp", "field"].includes(kind);
  const field = selected?.kind === "field" ? selected : null;
  const updateField = (patch: Partial<FieldAnnotation>, commit = true) => field && onUpdate({ ...field, ...patch }, commit);
  const showWidth = ["ink", "line", "arrow", "rect", "ellipse"].includes(kind);
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
          <div className="format-row" role="group" aria-label="Mise en forme">
            <button
              className={currentFont.bold ? "active" : ""}
              disabled={!boldKey}
              title={boldKey ? "Gras" : "Pas de variante grasse pour cette police"}
              onClick={() => boldKey && set({ fontKey: boldKey })}
            >
              <strong>G</strong>
            </button>
            <button
              className={currentFont.italic ? "active" : ""}
              disabled={!italicKey}
              title={italicKey ? "Italique" : "Pas de variante italique pour cette police"}
              onClick={() => italicKey && set({ fontKey: italicKey })}
            >
              <em>I</em>
            </button>
            <button className={v.underline ? "active" : ""} title="Souligné" onClick={() => set({ underline: !v.underline })}>
              <span style={{ textDecoration: "underline" }}>S</span>
            </button>
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

      {tool === "stamp" && !selected && <StampPicker onStamp={onStamp} />}

      {kind === "field" && (
        <>
          <label className="field">
            Type de champ
            <select
              value={field?.fieldType ?? style.fieldType}
              onChange={(e) => {
                const fieldType = e.target.value as FieldType;
                onStyle({ fieldType });
                updateField({ fieldType, options: fieldType === "dropdown" ? (field?.options ?? ["Choix 1", "Choix 2"]) : field?.options });
              }}
            >
              <option value="text">Zone de texte</option>
              <option value="checkbox">Case à cocher</option>
              <option value="dropdown">Liste déroulante</option>
            </select>
          </label>
          {field && (
            <>
              <label className="field">
                Nom du champ
                <input value={field.name} onChange={(e) => updateField({ name: e.target.value }, false)} onBlur={() => updateField({}, true)} />
              </label>
              {field.fieldType === "dropdown" && (
                <label className="field">
                  Choix proposés (un par ligne)
                  <textarea
                    rows={4}
                    value={(field.options ?? []).join("\n")}
                    onChange={(e) => updateField({ options: e.target.value.split("\n") }, false)}
                    onBlur={() => updateField({ options: (field.options ?? []).map((o) => o.trim()).filter(Boolean) }, true)}
                  />
                </label>
              )}
              {field.fieldType === "text" && (
                <label className="field inline">
                  <input type="checkbox" checked={!!field.multiline} onChange={(e) => updateField({ multiline: e.target.checked })} /> Plusieurs
                  lignes
                </label>
              )}
              {field.fieldType !== "checkbox" && (
                <label className="field">
                  Taille du texte saisi
                  <select value={field.fontSize} onChange={(e) => updateField({ fontSize: +e.target.value })}>
                    <option value={0}>Automatique</option>
                    {[8, 9, 10, 11, 12, 14, 16, 18, 24].map((s) => (
                      <option key={s} value={s}>
                        {s} pt
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <p className="hint">
            {field
              ? "Le champ devient un vrai champ de formulaire PDF à l'enregistrement : il se remplit ensuite dans Paperasse (onglet Formulaire), Acrobat ou un navigateur."
              : "Tracez le champ sur la page (ou touchez pour une taille standard). Choisissez d'abord son type."}
          </p>
        </>
      )}

      {!["select", "editText", "whiteout", "stamp", "field"].includes(kind) && (
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
