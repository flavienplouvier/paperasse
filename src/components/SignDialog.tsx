import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { DrawPad, clearPad, importSignature, renderScript, trimToPng } from "./DrawPad";
import { currentLocale, msg, t, tn, useLocale } from "../i18n";
import { DEFAULT_FONT_KEY, ensureCssFont, getFont } from "../lib/fonts";
import type { FileFont } from "../lib/fileFonts";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { FontSelect } from "./FontSelect";
import { renderStamp } from "../lib/stamp";
import { newId } from "../lib/types";
import { addPickedColor, loadPickedColors, toHex } from "../lib/pickedColors";
import { isoDate as isoToday } from "../lib/fileName";
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

/** AAAA-MM-JJ → date écrite dans la langue de l'interface. */
const showDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString(currentLocale()) : new Date().toLocaleDateString(currentLocale());
};

/** Lignes de texte d'une identité, à la date choisie (AAAA-MM-JJ). */
export function identityText(item: SignItem, date = isoToday()): string {
  const lines = [item.text ?? ""];
  const day = showDate(date);
  if (item.withDate) lines.push(item.city?.trim() ? t("Fait à {city}, le {date}", { city: item.city.trim(), date: day }) : t("Le {date}", { date: day }));
  return lines.filter(Boolean).join("\n");
}

/** Élément enregistré → élément à poser (image ou texte). */
export async function toPart(item: SignItem, date?: string, docFont = DEFAULT_FONT_KEY): Promise<PlacePart> {
  if (item.kind === "mention" && item.text) {
    await ensureCssFont(MENTION_FONT).catch(() => undefined);
    return { type: "text", text: item.text, fontKey: MENTION_FONT, fontSize: 16, color: item.color ?? INK[0] };
  }
  if (item.kind === "identity") {
    const fontKey = item.fontKey ?? docFont;
    await ensureCssFont(fontKey).catch(() => undefined);
    return { type: "text", text: identityText(item, date), fontKey, fontSize: 11, color: item.color ?? "#000000" };
  }
  const dataUrl = item.stamp ? renderStamp(item.stamp.label, item.stamp.color, item.stamp.withDate) : item.dataUrl!;
  const { w, h } = await imageSize(dataUrl);
  const width = WIDTH[item.kind];
  return { type: "image", dataUrl, width, height: (width * h) / w };
}

interface Props {
  /** Document ouvert et page affichée : aperçu de la paraphe sur toutes les pages. */
  pdf: PDFDocumentProxy | null;
  currentPage: number;
  /** Polices du document ouvert : la première sert de police par défaut à l'identité. */
  fileFonts: FileFont[];
  onPlace: (parts: PlacePart[]) => void;
  /** Paraphe posée en bas à droite de chaque page. */
  onInitialsEverywhere: (part: PlacePart) => void;
  onClose: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

export function SignDialog({ pdf, currentPage, fileFonts, onPlace, onInitialsEverywhere, onClose, onError, onInfo }: Props) {
  const docFont = fileFonts[0]?.key ?? DEFAULT_FONT_KEY;
  useLocale();
  const [items, setItems] = useState<SignItem[]>([]);
  const [tab, setTab] = useState<SignKind>("signature");
  const [editing, setEditing] = useState(false);
  /** Date écrite par l'identité : aujourd'hui par défaut, modifiable. */
  const [signDate, setSignDate] = useState(isoToday);
  const [chosen, setChosen] = useState<Partial<Record<SignKind, string>>>(() => {
    try {
      return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const loadInput = useRef<HTMLInputElement>(null);
  /** Paraphe sur toutes les pages, et sa taille en % (retenues). */
  const [allPages, setAllPages] = useState(() => readPref("paperasse-paraphe-partout") === "1");
  const [initialsScale, setInitialsScale] = useState(() => Number(readPref("paperasse-paraphe-taille")) || 100);
  useEffect(() => writePref("paperasse-paraphe-partout", allPages ? "1" : "0"), [allPages]);
  useEffect(() => writePref("paperasse-paraphe-taille", String(initialsScale)), [initialsScale]);

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
  /** Noms déjà donnés (tous onglets) : ils relient signature, paraphe, identité… d'une même personne ou d'un même usage. */
  const names = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of items) if (i.name?.trim() && !seen.has(i.name.trim().toLowerCase())) seen.set(i.name.trim().toLowerCase(), i.name.trim());
    return [...seen.values()].sort((a, b) => a.localeCompare(b, currentLocale()));
  }, [items]);
  /** Coche d'un coup tous les éléments portant ce nom (un par onglet). */
  const chooseProfile = (name: string) =>
    setChosen((c) => {
      const next = { ...c };
      for (const i of items) if (sameName(i.name, name)) next[i.kind] = i.id;
      return next;
    });
  const profileActive = (name: string) => items.filter((i) => sameName(i.name, name)).every((i) => chosen[i.kind] === i.id);

  const toggle = (item: SignItem) => setChosen((c) => ({ ...c, [item.kind]: c[item.kind] === item.id ? undefined : item.id }));

  const add = async (fresh: SignItem, remember: boolean) => {
    // Même nom dans le même onglet : l'ancien élément est remplacé (il garde sa place et son identifiant).
    const same = fresh.name ? items.find((i) => i.kind === fresh.kind && sameName(i.name, fresh.name)) : undefined;
    const item = same ? { ...fresh, id: same.id, createdAt: same.createdAt } : fresh;
    if (remember) await saveSignItem(item).catch(() => onError(t("Enregistrement impossible sur cet appareil (navigation privée ?).")));
    setItems((l) => (same ? l.map((i) => (i.id === same.id ? item : i)) : [...l, item]));
    setChosen((c) => ({ ...c, [item.kind]: item.id }));
    setEditing(false);
  };

  const remove = async (item: SignItem) => {
    if (!window.confirm(t("Supprimer cet élément ?"))) return;
    await deleteSignItem(item.id).catch(() => undefined);
    setItems((l) => l.filter((i) => i.id !== item.id));
  };

  const chosenInitials = items.find((i) => i.kind === "initials" && chosen.initials === i.id);
  const everywhere = allPages && !!chosenInitials;

  /** Paraphe à la taille réglée. */
  const scaled = (part: PlacePart): PlacePart =>
    part.type === "image" ? { ...part, width: (part.width * initialsScale) / 100, height: (part.height * initialsScale) / 100 } : part;

  const place = async () => {
    try {
      // Paraphe sur toutes les pages tout de suite ; le reste se pose d'un appui sur la page.
      const rest = everywhere ? selection.filter((i) => i.kind !== "initials") : selection;
      if (everywhere) onInitialsEverywhere(scaled(await toPart(chosenInitials, signDate, docFont)));
      if (rest.length) onPlace(await Promise.all(rest.map((i) => toPart(i, signDate, docFont))));
      else if (!everywhere) onClose();
    } catch (e) {
      onError((e as Error).message);
    }
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

        {names.length > 0 && (
          <div className="sign-profiles" aria-label={t("Profils")}>
            <span>{t("Profils")}</span>
            {names.map((n) => (
              <button key={n} className={profileActive(n) ? "active" : ""} title={t("Cocher tous les éléments « {name} »", { name: n })} onClick={() => chooseProfile(n)}>
                {n}
              </button>
            ))}
          </div>
        )}

        <div className="sign-body">
          {editing ? (
            <Editor key={tab} kind={tab} names={names} existing={items} date={signDate} onDate={setSignDate} fileFonts={fileFonts} docFont={docFont} onSave={add} onCancel={ofTab.length ? () => setEditing(false) : undefined} onError={onError} />
          ) : (
            <>
              <div className="sign-list">
                {ofTab.map((item) => (
                  <div key={item.id} className={`sign-card ${chosen[item.kind] === item.id ? "chosen" : ""}`}>
                    <label>
                      <input type="checkbox" checked={chosen[item.kind] === item.id} onChange={() => toggle(item)} />
                      <Preview item={item} date={signDate} docFont={docFont} />
                    </label>
                    <button className="icon-btn" title={t("Supprimer")} onClick={() => remove(item)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {tab === "identity" && <DateField value={signDate} onChange={setSignDate} />}
              <div className="modal-row">
                <button onClick={() => setEditing(true)}>
                  <Icon name="plus" size={18} /> {t("Nouveau")}
                </button>
              </div>
              {tab === "initials" && chosenInitials && (
                <div className="initials-all">
                  <label className="check">
                    <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} />
                    {t("Parapher toutes les pages")}
                  </label>
                  {allPages && (
                    <>
                      <label className="field">
                        <span>{t("Taille : {n} %", { n: initialsScale })}</span>
                        <input type="range" min={30} max={200} step={5} value={initialsScale} onChange={(e) => setInitialsScale(+e.target.value)} />
                      </label>
                      {pdf && chosenInitials.dataUrl && (
                        <InitialsPreview pdf={pdf} page={currentPage} dataUrl={chosenInitials.dataUrl} widthPt={(WIDTH.initials * initialsScale) / 100} />
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="sign-foot">
          <span className="sign-summary">
            {selection.length
              ? selection
                  .map((i) => (i.kind === "initials" && everywhere ? t("Paraphe (toutes les pages)") : t(TABS.find((x) => x.kind === i.kind)!.label)))
                  .join(" + ")
              : t("Cochez ce que vous voulez placer.")}
          </span>
          <button className="primary" disabled={!selection.length || editing} onClick={place}>
            {t("Placer")}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ noms

const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Champ du nom : la liste des noms déjà utilisés s'ouvre au clic et se filtre à la frappe. */
function NameField({ value, names, onChange }: { value: string; names: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const typed = value.trim().toLowerCase();
  // Le nom déjà tapé en entier n'est pas reproposé (l'avertissement de remplacement reste visible).
  const shown = names.filter((n) => n.toLowerCase() !== typed && (!typed || n.toLowerCase().includes(typed)));
  return (
    <div className="sign-name-field">
      <input
        className="sign-name-input"
        value={value}
        maxLength={64}
        placeholder={t("Nom (facultatif), ex. Pro")}
        aria-label={t("Nom de l'élément")}
        aria-autocomplete="list"
        aria-expanded={open && shown.length > 0}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && shown.length > 0 && (
        <ul className="sign-name-list" role="listbox">
          {shown.map((n) => (
            <li key={n}>
              <button
                type="button"
                role="option"
                aria-selected={n === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ aperçu

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* navigation privée */
  }
}

/** Page affichée en miniature, paraphe en bas à droite à la taille réglée (marge de 28 pt, comme à la pose). */
function InitialsPreview({ pdf, page, dataUrl, widthPt }: { pdf: PDFDocumentProxy; page: number; dataUrl: string; widthPt: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let alive = true;
    (async () => {
      const p = await pdf.getPage(Math.min(page, pdf.numPages - 1) + 1);
      const base = p.getViewport({ scale: 1 });
      const s = Math.min(240 / base.width, 320 / base.height);
      const vp = p.getViewport({ scale: s * (window.devicePixelRatio || 1) });
      const c = canvas.current;
      if (!alive || !c) return;
      c.width = vp.width;
      c.height = vp.height;
      c.style.width = `${base.width * s}px`;
      c.style.height = `${base.height * s}px`;
      task = p.render({ canvas: c, viewport: vp });
      await task.promise.catch(() => undefined);
      if (alive) setScale(s);
    })().catch(() => undefined);
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <div className="initials-preview">
      <canvas ref={canvas} />
      {scale > 0 && <img src={dataUrl} alt="" style={{ width: widthPt * scale, right: 28 * scale, bottom: 28 * scale }} />}
    </div>
  );
}

function Preview({ item, date, docFont }: { item: SignItem; date: string; docFont: string }) {
  return (
    <span className="sign-preview">
      <PreviewBody item={item} date={date} docFont={docFont} />
      {item.name && <small className="sign-name">{item.name}</small>}
    </span>
  );
}

function PreviewBody({ item, date, docFont }: { item: SignItem; date: string; docFont: string }) {
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
  return (
    <span className="sign-text" style={{ fontFamily: getFont(item.fontKey ?? docFont).cssFamily, color: item.color }}>
      {identityText(item, date)}
    </span>
  );
}

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field sign-date">
      <span>{t("Date de signature")}</span>
      <span className="modal-row">
        <input type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
        {value !== isoToday() && (
          <button type="button" className="link" onClick={() => onChange(isoToday())}>
            {t("Aujourd'hui")}
          </button>
        )}
      </span>
    </label>
  );
}

/** Couleurs de base, couleurs prises à la pipette, pipette (si le navigateur l'a) et choix libre. */
function ColorRow({ base, value, onChange }: { base: string[]; value: string; onChange: (c: string) => void }) {
  const [picked, setPicked] = useState(loadPickedColors);
  const remember = (c: string) => {
    const hex = toHex(c);
    if (!hex) return;
    if (![...base].includes(hex)) setPicked((l) => addPickedColor(l, hex));
    onChange(hex);
  };
  const dropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  const colors = [...base, ...picked.filter((c) => !base.includes(c))];
  return (
    <div className="swatches sign-colors">
      {colors.map((c) => (
        <button key={c} type="button" className={`swatch ${c === value ? "active" : ""}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={t("Couleur {color}", { color: c })} />
      ))}
      {dropper && (
        <button
          type="button"
          className="icon-btn"
          title={t("Pipette")}
          onClick={() =>
            new dropper()
              .open()
              .then((r) => remember(r.sRGBHex))
              .catch(() => undefined)
          }
        >
          <Icon name="pipette" size={18} />
        </button>
      )}
      <input type="color" value={value} title={t("Autre couleur")} onChange={(e) => onChange(e.target.value)} onBlur={(e) => remember(e.target.value)} />
    </div>
  );
}

// ------------------------------------------------------------------ création

type Mode = "draw" | "type" | "import";

function Editor({
  kind,
  date,
  onDate,
  fileFonts,
  docFont,
  names,
  existing,
  onSave,
  onCancel,
  onError,
}: {
  kind: SignKind;
  date: string;
  onDate: (d: string) => void;
  fileFonts: FileFont[];
  docFont: string;
  names: string[];
  existing: SignItem[];
  onSave: (item: SignItem, remember: boolean) => void;
  onCancel?: () => void;
  onError: (m: string) => void;
}) {
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
  const [name, setName] = useState("");
  /** Identité : police choisie explicitement (sinon celle du document). */
  const [identityFont, setIdentityFont] = useState<string | null>(null);
  /** Signature / paraphe écrite : police choisie dans la liste complète (6e case). */
  const [otherFont, setOtherFont] = useState<string | null>(null);
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

  const base = { id: newId("sign"), kind, createdAt: Date.now(), ...(name.trim() ? { name: name.trim() } : {}) };
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
      if (kind === "identity") return onSave({ ...base, text: text.trim(), city: city.trim(), withDate, color, ...(identityFont ? { fontKey: identityFont } : {}) }, remember);
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
          <div className="modal-row">
            <label className="check">
              <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
              {t("Ajouter « Fait à …, le »")}
            </label>
            <input type="date" value={date} disabled={!withDate} aria-label={t("Date de signature")} onChange={(e) => e.target.value && onDate(e.target.value)} />
          </div>
          {withDate && (
            <label className="field">
              <span>{t("Ville (facultatif)")}</span>
              <input value={city} placeholder={t("Ex. Lyon")} onChange={(e) => setCity(e.target.value)} />
            </label>
          )}
          <div className="field">
            <span>{t("Police")}</span>
            <FontSelect value={identityFont ?? docFont} onChange={setIdentityFont} onError={onError} fileFonts={fileFonts} />
          </div>
          {text.trim() && (
            <pre className="sign-text" style={{ fontFamily: getFont(identityFont ?? docFont).cssFamily, color }}>
              {identityText({ ...base, text, city, withDate }, date)}
            </pre>
          )}
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
            <FontSelect
              value={otherFont ?? docFont}
              active={!!otherFont && font === otherFont}
              color={color}
              sample={text.trim() || (kind === "initials" ? "L.M." : "Léa Martin")}
              fileFonts={fileFonts}
              onError={onError}
              onChange={(k) => {
                setOtherFont(k);
                setFont(k);
              }}
            />
          </div>
        </>
      )}

      {mode !== "import" && (
        <div className="modal-row">
          <ColorRow base={kind === "stamp" ? STAMP_COLORS : INK} value={color} onChange={setColor} />
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

      {name.trim() && existing.some((i) => i.kind === kind && sameName(i.name, name)) && (
        <p className="hint sign-replace">{t("Remplacera l'élément « {name} » de cet onglet.", { name: name.trim() })}</p>
      )}
      <div className="modal-row sign-save">
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t("Mémoriser sur cet appareil")}
        </label>
        <NameField value={name} names={names} onChange={setName} />
        {onCancel && <button onClick={onCancel}>{t("Annuler")}</button>}
        <button className="primary" disabled={!ready} onClick={save}>
          {t("Enregistrer")}
        </button>
      </div>
    </div>
  );
}

