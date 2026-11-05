import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { DrawPad, clearPad, importSignature, renderScript, trimToPng } from "./DrawPad";
import { currentLocale, msg, t, tn, useLocale } from "../i18n";
import { ensureCssFont, getFont } from "../lib/fonts";
import { renderStamp } from "../lib/stamp";
import { newId } from "../lib/types";
import {
  clearSignItems,
  deleteSignItem,
  exportSignItems,
  listSignItems,
  parseSignItems,
  saveSignItem,
  sortForStack,
  type PlacePart,
  type SignItem,
  type SignKind,
} from "../lib/signatures";

/**
 * Signer : signatures, paraphes, mentions, identité et tampons enregistrés sur
 * l'appareil. On coche ce qu'on veut poser (un élément par onglet), puis on
 * touche la page : les éléments arrivent empilés, chacun dans son cadre.
 */

const TABS: { kind: SignKind; label: string; icon: string }[] = [
  { kind: "signature", label: msg("Signature"), icon: "sign" },
  { kind: "initials", label: msg("Paraphe"), icon: "pen" },
  { kind: "mention", label: msg("Mention"), icon: "text" },
  { kind: "identity", label: msg("Identité"), icon: "form" },
  { kind: "stamp", label: msg("Tampon"), icon: "stamp" },
];

const INK = ["#1a2b6d", "#000000", "#0b6b3a", "#b3261e"];
const STAMP_COLORS = ["#c62828", "#1d5fbf", "#1f8a4c", "#6b7280"];
const SCRIPT_FONTS = ["lib:caveat:regular", "lib:dancing-script:regular", "lib:great-vibes:regular", "lib:allura:regular", "lib:sacramento:regular"];
const MENTION_FONT = "lib:caveat:regular";
const MENTIONS = [msg("Lu et approuvé"), msg("Bon pour accord"), msg("Lu et approuvé, bon pour accord"), msg("Certifié conforme"), msg("Bon pour pouvoir")];
/** Largeur de pose (points PDF) des éléments image. */
const WIDTH: Record<SignKind, number> = { signature: 160, initials: 60, mention: 150, identity: 160, stamp: 150 };

const CHOICE_KEY = "paperasse-signer-choix";

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => rej(new Error(t("Image illisible.")));
    img.src = dataUrl;
  });
}

const today = () => new Date().toLocaleDateString(currentLocale());

/** Lignes de texte d'une identité. */
export function identityText(item: SignItem): string {
  const lines = [item.text ?? ""];
  if (item.withDate) lines.push(item.city?.trim() ? t("Fait à {city}, le {date}", { city: item.city.trim(), date: today() }) : t("Le {date}", { date: today() }));
  return lines.filter(Boolean).join("\n");
}

/** Élément enregistré → élément à poser (image ou texte). */
export async function toPart(item: SignItem): Promise<PlacePart> {
  if (item.kind === "mention" && item.text) {
    await ensureCssFont(MENTION_FONT).catch(() => undefined);
    return { type: "text", text: item.text, fontKey: MENTION_FONT, fontSize: 16, color: item.color ?? INK[0] };
  }
  if (item.kind === "identity") return { type: "text", text: identityText(item), fontKey: "std:Helvetica", fontSize: 11, color: item.color ?? "#000000" };
  const dataUrl = item.stamp ? renderStamp(item.stamp.label, item.stamp.color, item.stamp.withDate) : item.dataUrl!;
  const { w, h } = await imageSize(dataUrl);
  const width = WIDTH[item.kind];
  return { type: "image", dataUrl, width, height: (width * h) / w };
}

interface Props {
  onPlace: (parts: PlacePart[]) => void;
  /** Paraphe posée en bas à droite de chaque page. */
  onInitialsEverywhere: (part: PlacePart) => void;
  onClose: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

export function SignDialog({ onPlace, onInitialsEverywhere, onClose, onError, onInfo }: Props) {
  useLocale();
  const [items, setItems] = useState<SignItem[]>([]);
  const [tab, setTab] = useState<SignKind>("signature");
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<Partial<Record<SignKind, string>>>(() => {
    try {
      return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const loadInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listSignItems()
      .then((list) => {
        setItems(list);
        if (!list.some((i) => i.kind === "signature")) setEditing(true);
      })
      .catch(() => setEditing(true));
  }, []);

  // Choix retenu d'une fois sur l'autre, en ignorant les éléments supprimés.
  const selection = useMemo(() => sortForStack(items.filter((i) => chosen[i.kind] === i.id)), [items, chosen]);
  useEffect(() => {
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify(chosen));
    } catch {
      /* navigation privée */
    }
  }, [chosen]);

  const ofTab = items.filter((i) => i.kind === tab);

  const toggle = (item: SignItem) => setChosen((c) => ({ ...c, [item.kind]: c[item.kind] === item.id ? undefined : item.id }));

  const add = async (item: SignItem, remember: boolean) => {
    if (remember) await saveSignItem(item).catch(() => onError(t("Enregistrement impossible sur cet appareil (navigation privée ?).")));
    setItems((l) => [...l, item]);
    setChosen((c) => ({ ...c, [item.kind]: item.id }));
    setEditing(false);
  };

  const remove = async (item: SignItem) => {
    if (!window.confirm(t("Supprimer cet élément ?"))) return;
    await deleteSignItem(item.id).catch(() => undefined);
    setItems((l) => l.filter((i) => i.id !== item.id));
  };

  const place = async () => {
    try {
      onPlace(await Promise.all(selection.map(toPart)));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const initialsEverywhere = async () => {
    const item = items.find((i) => i.kind === "initials" && chosen.initials === i.id);
    if (item) onInitialsEverywhere(await toPart(item));
  };

  const download = () => {
    const blob = new Blob([exportSignItems(items)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "paperasse-signatures.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    onInfo(t("Sauvegarde téléchargée. Elle contient vos signatures : gardez-la en lieu sûr."));
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    const list = parseSignItems(await file.text());
    if (!list) return onError(t("Ce fichier n'est pas une sauvegarde de signatures Paperasse."));
    const known = new Set(items.map((i) => i.id));
    const fresh = list.filter((i) => !known.has(i.id));
    for (const i of fresh) await saveSignItem(i).catch(() => undefined);
    setItems((l) => [...l, ...fresh]);
    onInfo(tn("{n} élément chargé.", "{n} éléments chargés.", fresh.length));
  };

  const wipe = async () => {
    if (!window.confirm(t("Effacer toutes les signatures, paraphes, mentions, identités et tampons enregistrés sur cet appareil ?"))) return;
    await clearSignItems().catch(() => undefined);
    setItems([]);
    setChosen({});
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sign-dialog" role="dialog" aria-label={t("Signer")} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t("Signer")}</h2>
          <div className="sign-head-actions">
            <button className="icon-btn" title={t("Sauvegarder dans un fichier")} disabled={!items.length} onClick={download}>
              <Icon name="extract" size={18} />
            </button>
            <button className="icon-btn" title={t("Charger une sauvegarde")} onClick={() => loadInput.current?.click()}>
              <Icon name="upload" size={18} />
            </button>
            <button className="icon-btn" title={t("Tout effacer de cet appareil")} disabled={!items.length} onClick={wipe}>
              <Icon name="trash" size={18} />
            </button>
            <button className="icon-btn" title={t("Fermer")} onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <input ref={loadInput} type="file" accept=".json,application/json" hidden onChange={(e) => (load(e.target.files?.[0]), (e.target.value = ""))} />
        </header>

        <nav className="sign-tabs" role="tablist">
          {TABS.map((tb) => (
            <button
              key={tb.kind}
              role="tab"
              aria-selected={tab === tb.kind}
              className={tab === tb.kind ? "active" : ""}
              onClick={() => {
                setTab(tb.kind);
                setEditing(!items.some((i) => i.kind === tb.kind));
              }}
            >
              <Icon name={tb.icon} size={18} />
              <span>{t(tb.label)}</span>
              {chosen[tb.kind] && items.some((i) => i.id === chosen[tb.kind]) && <i className="sign-dot" />}
            </button>
          ))}
        </nav>

        <div className="sign-body">
          {editing ? (
            <Editor kind={tab} onSave={add} onCancel={ofTab.length ? () => setEditing(false) : undefined} onError={onError} />
          ) : (
            <>
              <div className="sign-list">
                {ofTab.map((item) => (
                  <div key={item.id} className={`sign-card ${chosen[item.kind] === item.id ? "chosen" : ""}`}>
                    <label>
                      <input type="checkbox" checked={chosen[item.kind] === item.id} onChange={() => toggle(item)} />
                      <Preview item={item} />
                    </label>
                    <button className="icon-btn" title={t("Supprimer")} onClick={() => remove(item)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="modal-row">
                <button onClick={() => setEditing(true)}>
                  <Icon name="plus" size={18} /> {t("Nouveau")}
                </button>
                {tab === "initials" && (
                  <button disabled={!chosen.initials || !ofTab.some((i) => i.id === chosen.initials)} onClick={initialsEverywhere}>
                    <Icon name="pages" size={18} /> {t("Parapher toutes les pages")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="sign-foot">
          <span className="sign-summary">
            {selection.length ? selection.map((i) => t(TABS.find((x) => x.kind === i.kind)!.label)).join(" + ") : t("Cochez ce que vous voulez placer.")}
          </span>
          <button className="primary" disabled={!selection.length || editing} onClick={place}>
            {t("Placer")}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ aperçu

function Preview({ item }: { item: SignItem }) {
  const stampUrl = useMemo(() => (item.stamp ? renderStamp(item.stamp.label, item.stamp.color, item.stamp.withDate) : null), [item.stamp]);
  const [mentionFont, setMentionFont] = useState<string | undefined>();
  useEffect(() => {
    if (item.kind !== "mention" || !item.text) return;
    ensureCssFont(MENTION_FONT)
      .then(() => setMentionFont(getFont(MENTION_FONT).cssFamily))
      .catch(() => undefined);
  }, [item.kind, item.text]);
  if (stampUrl || item.dataUrl) return <img className="sign-thumb" src={stampUrl ?? item.dataUrl} alt="" />;
  if (item.kind === "mention") return <span className="sign-text mention" style={{ fontFamily: mentionFont, color: item.color }}>{item.text}</span>;
  return <span className="sign-text">{identityText(item)}</span>;
}

// ------------------------------------------------------------------ création

type Mode = "draw" | "type" | "import";

function Editor({ kind, onSave, onCancel, onError }: { kind: SignKind; onSave: (item: SignItem, remember: boolean) => void; onCancel?: () => void; onError: (m: string) => void }) {
  useLocale();
  const modes: Mode[] = kind === "identity" ? ["type"] : kind === "mention" ? ["type", "draw"] : ["draw", "type", "import"];
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [color, setColor] = useState(kind === "stamp" ? STAMP_COLORS[0] : kind === "identity" ? "#000000" : INK[0]);
  const [text, setText] = useState("");
  const [city, setCity] = useState("");
  const [withDate, setWithDate] = useState(true);
  const [font, setFont] = useState(SCRIPT_FONTS[0]);
  const [fontsReady, setFontsReady] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [remember, setRemember] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText("");
    setImported(null);
    setDrawn(false);
  }, [kind, mode]);

  // Polices manuscrites chargées pour l'aperçu de l'écriture au clavier.
  useEffect(() => {
    if (mode !== "type" || kind === "identity" || kind === "stamp") return;
    const list = kind === "mention" ? [MENTION_FONT] : SCRIPT_FONTS;
    Promise.all(list.map((k) => ensureCssFont(k).catch(() => undefined))).then(() => setFontsReady((n) => n + 1));
  }, [mode, kind]);

  const base = { id: newId("sign"), kind, createdAt: Date.now() };
  const textMode = mode === "type";

  const save = async () => {
    try {
      if (mode === "draw") {
        const png = trimToPng(canvas.current!);
        if (!png) return;
        return onSave({ ...base, dataUrl: png, color }, remember);
      }
      if (mode === "import") return imported && onSave({ ...base, dataUrl: imported }, remember);
      if (!text.trim()) return;
      if (kind === "mention") return onSave({ ...base, text: text.trim(), color }, remember);
      if (kind === "identity") return onSave({ ...base, text: text.trim(), city: city.trim(), withDate, color }, remember);
      if (kind === "stamp") return onSave({ ...base, stamp: { label: text.trim(), color, withDate } }, remember);
      const png = await renderScript(text.trim(), font, color);
      if (png) onSave({ ...base, dataUrl: png, color }, remember);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const ready = mode === "draw" ? drawn : mode === "import" ? !!imported : !!text.trim();
  const modeLabel: Record<Mode, string> = { draw: t("Dessiner"), type: kind === "stamp" ? t("Texte") : t("Écrire"), import: t("Importer") };

  return (
    <div className="sign-editor">
      {modes.length > 1 && (
        <div className="seg" role="radiogroup">
          {modes.map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      )}

      {mode === "draw" && (
        <>
          <DrawPad color={color} canvasRef={canvas} onDraw={() => setDrawn(true)} height={kind === "initials" ? 150 : 200} />
          <p className="hint">{kind === "initials" ? t("Tracez vos initiales dans le cadre.") : kind === "mention" ? t("Écrivez la mention dans le cadre.") : t("Signez dans le cadre.")}</p>
        </>
      )}

      {mode === "import" && (
        <div className="sign-import">
          {imported ? <img className="sign-thumb big" src={imported} alt="" /> : <p className="hint">{kind === "stamp" ? t("Photo ou scan du tampon (ex. tampon de l'entreprise).") : t("Photo ou scan sur fond blanc.")}</p>}
          <div className="modal-row">
            <button onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={18} /> {t("Choisir une image")}
            </button>
            <label className="check">
              <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} />
              {t("Retirer le fond blanc")}
            </label>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                setImported(await importSignature(f, removeBackground));
              } catch (err) {
                onError(err instanceof Error ? err.message : t("Image illisible."));
              }
            }}
          />
        </div>
      )}

      {textMode && kind === "mention" && (
        <>
          <div className="chips">
            {MENTIONS.map((m) => (
              <button key={m} className={text === t(m) ? "active" : ""} onClick={() => setText(t(m))}>
                {t(m)}
              </button>
            ))}
          </div>
          <input value={text} placeholder={t("Votre mention")} onChange={(e) => setText(e.target.value)} style={{ fontFamily: fontsReady ? getFont(MENTION_FONT).cssFamily : undefined, fontSize: 22 }} />
        </>
      )}

      {textMode && kind === "identity" && (
        <>
          <label className="field">
            <span>{t("Prénom et nom")}</span>
            <input autoFocus value={text} placeholder={t("Ex. Léa Martin")} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
            {t("Ajouter « Fait à …, le {date} »", { date: today() })}
          </label>
          {withDate && (
            <label className="field">
              <span>{t("Ville (facultatif)")}</span>
              <input value={city} placeholder={t("Ex. Lyon")} onChange={(e) => setCity(e.target.value)} />
            </label>
          )}
          {text.trim() && <pre className="sign-text">{identityText({ ...base, text, city, withDate })}</pre>}
        </>
      )}

      {textMode && kind === "stamp" && (
        <>
          <input autoFocus value={text} placeholder={t("Ex. Service comptabilité")} onChange={(e) => setText(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
            {t("Avec la date du jour")}
          </label>
          {text.trim() && <img className="sign-thumb big" src={renderStamp(text, color, withDate)} alt="" />}
        </>
      )}

      {textMode && (kind === "signature" || kind === "initials") && (
        <>
          <input autoFocus value={text} placeholder={kind === "initials" ? t("Vos initiales") : t("Votre nom")} onChange={(e) => setText(e.target.value)} />
          <div className="script-fonts" key={fontsReady}>
            {SCRIPT_FONTS.map((k) => (
              <button key={k} className={font === k ? "active" : ""} style={{ fontFamily: getFont(k).cssFamily, color }} onClick={() => setFont(k)}>
                {text.trim() || (kind === "initials" ? "L.M." : "Léa Martin")}
              </button>
            ))}
          </div>
        </>
      )}

      {mode !== "import" && (
        <div className="modal-row">
          {(kind === "stamp" ? STAMP_COLORS : INK).map((c) => (
            <button key={c} className={`swatch ${c === color ? "active" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={t("Couleur {color}", { color: c })} />
          ))}
          {mode === "draw" && (
            <button
              onClick={() => {
                clearPad(canvas.current);
                setDrawn(false);
              }}
            >
              {t("Effacer")}
            </button>
          )}
        </div>
      )}

      <div className="modal-row sign-save">
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t("Mémoriser sur cet appareil")}
        </label>
        <span className="spacer" />
        {onCancel && <button onClick={onCancel}>{t("Annuler")}</button>}
        <button className="primary" disabled={!ready} onClick={save}>
          {t("Enregistrer")}
        </button>
      </div>
    </div>
  );
}

