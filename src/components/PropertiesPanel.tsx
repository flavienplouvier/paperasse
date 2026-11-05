import type { FileFont } from "../lib/fileFonts";
import type { Annotation, FieldAnnotation, FieldType, Tool } from "../lib/types";
import { borrowedChars, missingChars } from "../lib/embeddedFonts";
import { ensureCssFont, getFont, matchFont, styleVariant } from "../lib/fonts";
import { StampPanel } from "./StampPanel";
import { SHAPES, shapeDef, type ShapeId } from "../lib/shapes";
import type { ToolStyle } from "./PageView";
import { FontPicker, useFonts } from "./FontPicker";
import { Icon } from "./Icon";
import { msg, t, tn, useLocale } from "../i18n";

/** Met en gras la valeur {font} d'une phrase traduite (laissée intacte par t). */
function withStrong(text: string, value: string) {
  const [before, after = ""] = text.split("{font}");
  return (
    <>
      {before}
      <strong>{value}</strong>
      {after}
    </>
  );
}

export const COLORS = ["#000000", "#ffffff", "#e5484d", "#f76b15", "#ffe14d", "#30a46c", "#0090ff", "#1a2b6d", "#8e4ec6"];

/**
 * Applique un réglage (couleur, police, épaisseur…) : il est retenu pour les
 * éléments suivants (`onStyle`) et appliqué à l'élément sélectionné s'il y en a un.
 * Partagé par le panneau de réglages et la barre d'outils mobile.
 */
export function applyStyle(
  patch: Partial<ToolStyle> & { text?: string },
  selected: Annotation | null,
  onStyle: (p: Partial<ToolStyle>) => void,
  onUpdate: (a: Annotation, commit: boolean) => void,
  commit = true,
) {
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
}

/** Valeurs affichées : celles de l'élément sélectionné, sinon celles de l'outil. */
export function currentStyle(selected: Annotation | null, style: ToolStyle) {
  return {
    color: selected?.color ?? style.color,
    opacity: selected?.opacity ?? style.opacity,
    width: selected && "width" in selected ? selected.width : style.width,
    fill: selected && "fill" in selected ? selected.fill : style.fill,
    fontKey: selected?.kind === "text" ? selected.fontKey : style.fontKey,
    fontSize: selected?.kind === "text" ? selected.fontSize : style.fontSize,
    underline: selected?.kind === "text" ? !!selected.underline : style.underline,
  };
}

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
  onTool: (tool: Tool) => void;
  /** Dernières couleurs prises à la pipette (la plus récente d'abord). */
  pickedColors: string[];
  /** Pipette : renvoie la couleur copiée sur la page, ou null si annulé. */
  onPickColor: () => Promise<string | null>;
  /** Polices du fichier ouvert (proposées en premier dans le sélecteur). */
  fileFonts: FileFont[];
}

const DRAW_CHOICES: { id: string; label: string; icon: string; tool: Tool; doubleArrow?: boolean }[] = [
  { id: "ink", label: msg("Stylo"), icon: "pen", tool: "ink" },
  { id: "highlight", label: msg("Surligneur"), icon: "highlight", tool: "highlight" },
  { id: "line", label: msg("Trait"), icon: "line", tool: "line" },
  { id: "arrow", label: msg("Flèche"), icon: "arrow", tool: "arrow", doubleArrow: false },
  { id: "double", label: msg("Double flèche"), icon: "doubleArrow", tool: "arrow", doubleArrow: true },
];

/** Aperçu d'une forme pour la grille de choix. */
function ShapeIcon({ id }: { id: ShapeId }) {
  const def = shapeDef(id);
  if (!def.path) return null;
  const w = 26;
  const h = id === "arrowLeft" || id === "arrowRight" || id === "parallelogram" || id === "trapezoid" ? 18 : 26;
  return (
    <svg width={30} height={30} viewBox="-2 -2 30 30" aria-hidden="true">
      <path d={def.path(w, h)} transform={`translate(0 ${(26 - h) / 2})`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PropertiesPanel({
  tool,
  style,
  selected,
  onStyle,
  onUpdate,
  onDelete,
  onDuplicate,
  onError,
  onStamp,
  onTool,
  pickedColors,
  onPickColor,
  fileFonts,
}: Props) {
  useFonts(); // re-rendu quand la bibliothèque de polices est chargée (boutons G / I)
  useLocale();
  // Modifie l'annotation sélectionnée, et retient le réglage pour les suivantes.
  const set = (patch: Partial<ToolStyle> & { text?: string }, commit = true) => applyStyle(patch, selected, onStyle, onUpdate, commit);

  const kind = selected?.kind ?? tool;
  const v = currentStyle(selected, style);
  /**
   * Après chargement des polices de l'ordinateur : si le texte modifié vient d'une
   * police qui y est installée (ex. Times New Roman, Calibri), on l'utilise à la
   * place de l'équivalent. La police incorporée d'origine reste prioritaire.
   */
  const rematchOriginal = async () => {
    if (selected?.kind !== "text" || !selected.originalFont) return;
    const { name, bold, italic } = selected.originalFont;
    const key = matchFont(name, undefined, { bold, italic });
    if (key === selected.fontKey || !key.startsWith("local:")) return;
    try {
      await ensureCssFont(key);
    } catch {
      return;
    }
    onUpdate({ ...selected, fontKey: key }, true);
  };

  const currentFont = getFont(v.fontKey);
  const boldKey = styleVariant(v.fontKey, !currentFont.bold, !!currentFont.italic);
  const italicKey = styleVariant(v.fontKey, !!currentFont.bold, !currentFont.italic);

  const showColor = !["image", "whiteout", "select", "editText", "stamp", "field", "eraser"].includes(kind);
  const field = selected?.kind === "field" ? selected : null;
  const updateField = (patch: Partial<FieldAnnotation>, commit = true) => field && onUpdate({ ...field, ...patch }, commit);
  const showWidth = ["ink", "line", "arrow", "rect", "ellipse", "shape"].includes(kind);
  const showFill = kind === "rect" || kind === "ellipse" || kind === "shape";
  const showText = kind === "text" || kind === "editText";

  return (
    <div className="props-panel">
      <h3>{selected ? t("Élément sélectionné") : t("Réglages de l'outil")}</h3>

      {selected?.kind === "text" && (
        <label className="field">
          {t("Texte")}
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
        const borrowed = borrowedChars(selected.embedded, selected.text);
        const name = selected.embedded.baseFont.replace(/^[A-Z]{6}\+/, "");
        return missing.length === 0 ? (
          <p className="font-status ok">
            {withStrong(
              selected.embedded.notEmbedded
                ? t("Police d'origine du PDF : {font} (police standard, rendu identique).")
                : t("Police d'origine du PDF : {font} (incorporée, rendu identique)."),
              name,
            )}
            {borrowed.length > 0 && (
              <>
                {" "}
                {tn("« {chars} » retrouvé ailleurs dans le PDF.", "« {chars} » retrouvés ailleurs dans le PDF.", borrowed.length, {
                  chars: borrowed.join(" "),
                })}
              </>
            )}
          </p>
        ) : (
          <p className="font-status warn">
            {withStrong(
              tn(
                "« {chars} » n'existe pas dans la police {font} incorporée au PDF : seul ce caractère utilise la police de remplacement ci-dessous, le reste garde la police d'origine. Pour le vrai glyphe, installez la police {name} sur l'ordinateur ou importez-la (TTF/OTF) puis choisissez-la ci-dessous.",
                "« {chars} » n'existe pas dans la police {font} incorporée au PDF : seuls ces caractères utilisent la police de remplacement ci-dessous, le reste garde la police d'origine. Pour le vrai glyphe, installez la police {name} sur l'ordinateur ou importez-la (TTF/OTF) puis choisissez-la ci-dessous.",
                missing.length,
                { chars: missing.join(" "), name },
              ),
              name,
            )}
          </p>
        );
      })()}

      {showText && (
        <>
          <div className="field">
            {selected?.kind === "text" && selected.embedded ? t("Police de remplacement") : t("Police")}
            <FontPicker
              value={v.fontKey}
              onChange={(fontKey) => set({ fontKey })}
              onError={onError}
              onLocalFonts={rematchOriginal}
              fileFonts={fileFonts}
            />
          </div>
          <div className="format-row" role="group" aria-label={t("Mise en forme")}>
            <button
              className={currentFont.bold ? "active" : ""}
              disabled={!boldKey}
              title={boldKey ? t("Gras") : t("Pas de variante grasse pour cette police")}
              onClick={() => boldKey && set({ fontKey: boldKey })}
            >
              <strong>{t("G")}</strong>
            </button>
            <button
              className={currentFont.italic ? "active" : ""}
              disabled={!italicKey}
              title={italicKey ? t("Italique") : t("Pas de variante italique pour cette police")}
              onClick={() => italicKey && set({ fontKey: italicKey })}
            >
              <em>{t("I")}</em>
            </button>
            <button className={v.underline ? "active" : ""} title={t("Souligné")} onClick={() => set({ underline: !v.underline })}>
              <span style={{ textDecoration: "underline" }}>{t("S")}</span>
            </button>
          </div>
          <label className="field">
            {t("Taille : {n} pt", { n: Math.round(v.fontSize * 10) / 10 })}
            <input type="range" min={4} max={96} step={0.5} value={v.fontSize} onChange={(e) => set({ fontSize: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
          </label>
        </>
      )}

      {showColor && (
        <div className="field">
          {t("Couleur")}
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} className={`swatch ${c === v.color ? "active" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
            ))}
            <input type="color" value={v.color} onChange={(e) => set({ color: e.target.value })} aria-label={t("Couleur personnalisée")} />
            <button
              className="swatch-tool"
              title={t("Pipette : copier une couleur de la page")}
              aria-label={t("Pipette")}
              onClick={async () => {
                const c = await onPickColor();
                if (c) set({ color: c });
              }}
            >
              <Icon name="pipette" />
            </button>
          </div>
          {pickedColors.length > 0 && (
            <>
              <span className="hint">{t("Pipette")}</span>
              <div className="swatches">
                {pickedColors.map((c) => (
                  <button key={c} className={`swatch ${c === v.color ? "active" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} title={c} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showWidth && (
        <label className="field">
          {t("Épaisseur : {n} pt", { n: v.width })}
          <input type="range" min={0.5} max={20} step={0.5} value={v.width} onChange={(e) => set({ width: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
        </label>
      )}

      {showFill && (
        <label className="field inline">
          <input type="checkbox" checked={v.fill} onChange={(e) => set({ fill: e.target.checked })} />{" "}
          {t("Forme pleine")}
        </label>
      )}

      {tool === "stamp" && !selected && <StampPanel onStamp={onStamp} onError={onError} />}

      {["ink", "highlight", "line", "arrow"].includes(tool) && !selected && (
        <div className="field">
          {t("Outil de dessin")}
          <div className="choice-grid draw" role="radiogroup" aria-label={t("Outil de dessin")}>
            {DRAW_CHOICES.map((c) => {
              const active = c.tool === tool && (c.doubleArrow === undefined || c.doubleArrow === style.doubleArrow);
              return (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={active}
                  className={active ? "active" : ""}
                  title={t(c.label)}
                  onClick={() => {
                    if (c.doubleArrow !== undefined) onStyle({ doubleArrow: c.doubleArrow });
                    onTool(c.tool);
                  }}
                >
                  <Icon name={c.icon} />
                  <span>{t(c.label)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {["shape", "rect", "ellipse"].includes(tool) && !selected && (
        <div className="field">
          {t("Forme")}
          <div className="choice-grid shapes" role="radiogroup" aria-label={t("Forme")}>
            {SHAPES.filter((s) => !s.linear).map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={tool === "shape" && style.shape === s.id}
                className={tool === "shape" && style.shape === s.id ? "active" : ""}
                title={t(s.label)}
                aria-label={t(s.label)}
                onClick={() => {
                  onStyle({ shape: s.id });
                  onTool("shape");
                }}
              >
                <ShapeIcon id={s.id} />
              </button>
            ))}
          </div>
          <p className="hint">{t("Tracez la forme sur la page, ou touchez pour une taille standard.")}</p>
        </div>
      )}

      {kind === "field" && (
        <>
          <label className="field">
            {t("Type de champ")}
            <select
              value={field?.fieldType ?? style.fieldType}
              onChange={(e) => {
                const fieldType = e.target.value as FieldType;
                onStyle({ fieldType });
                updateField({ fieldType, options: fieldType === "dropdown" ? (field?.options ?? [t("Choix 1"), t("Choix 2")]) : field?.options });
              }}
            >
              <option value="text">{t("Zone de texte")}</option>
              <option value="checkbox">{t("Case à cocher")}</option>
              <option value="dropdown">{t("Liste déroulante")}</option>
            </select>
          </label>
          {field && (
            <>
              <label className="field">
                {t("Nom du champ")}
                <input value={field.name} onChange={(e) => updateField({ name: e.target.value }, false)} onBlur={() => updateField({}, true)} />
              </label>
              {field.fieldType === "dropdown" && (
                <label className="field">
                  {t("Choix proposés (un par ligne)")}
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
                  <input type="checkbox" checked={!!field.multiline} onChange={(e) => updateField({ multiline: e.target.checked })} />{" "}
                  {t("Plusieurs lignes")}
                </label>
              )}
              {field.fieldType !== "checkbox" && (
                <label className="field">
                  {t("Taille du texte saisi")}
                  <select value={field.fontSize} onChange={(e) => updateField({ fontSize: +e.target.value })}>
                    <option value={0}>{t("Automatique")}</option>
                    {[8, 9, 10, 11, 12, 14, 16, 18, 24].map((s) => (
                      <option key={s} value={s}>
                        {t("{n} pt", { n: s })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <p className="hint">
            {field
              ? t(
                  "Le champ devient un vrai champ de formulaire PDF à l'enregistrement : il se remplit ensuite dans Paperasse (onglet Formulaire), Acrobat ou un navigateur.",
                )
              : t("Tracez le champ sur la page (ou touchez pour une taille standard). Choisissez d'abord son type.")}
          </p>
        </>
      )}

      {tool === "eraser" && (
        <p className="hint">
          {t(
            "Touchez un élément ajouté (trait, forme, texte, tampon, image…) ou passez dessus pour le supprimer. Le contenu d'origine du PDF n'est pas touché : pour le masquer, utilisez le cache blanc. Ctrl+Z pour annuler.",
          )}
        </p>
      )}

      {!["select", "editText", "whiteout", "stamp", "field", "eraser"].includes(kind) && (
        <label className="field">
          {t("Opacité : {n} %", { n: Math.round(v.opacity * 100) })}
          <input type="range" min={0.1} max={1} step={0.05} value={v.opacity} onChange={(e) => set({ opacity: +e.target.value }, false)} onPointerUp={() => set({}, true)} />
        </label>
      )}

      {tool === "editText" && !selected && (
        <p className="hint">
          {t(
            "Touchez un texte du PDF : il est masqué et remplacé par un texte modifiable, dans la police d'origine si elle est disponible sur cet appareil.",
          )}
        </p>
      )}
      {tool === "select" && !selected && <p className="hint">{t("Touchez un élément ajouté pour le déplacer, le redimensionner ou le modifier.")}</p>}

      {selected && (
        <div className="panel-actions">
          <button onClick={onDuplicate}>
            <Icon name="copy" /> {t("Dupliquer")}
          </button>
          <button className="danger" onClick={onDelete}>
            <Icon name="trash" /> {t("Supprimer")}
          </button>
        </div>
      )}
    </div>
  );
}
