import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { DrawPad, clearPad, importSignature, renderScript, trimToPng } from "./DrawPad";
import { currentLocale, msg, t, tn, useLocale } from "../i18n";
import { DEFAULT_FONT_KEY, ensureCssFont, getFont } from "../lib/fonts";
import type { FileFont } from "../lib/fileFonts";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import type { Annotation } from "../lib/types";
import { FontSelect } from "./FontSelect";
import { renderStamp, renderStampSpec } from "../lib/stamp";
import { stampSpecOf } from "./StampPanel";
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
  boxAt,
  cornerPosition,
  freeSpot,
  obstaclesOn,
  partHeight,
  partWidth,
  type Box,
  type PagePosition,
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
  if (item.kind === "identity" && !item.dataUrl) {
    const fontKey = item.fontKey ?? docFont;
    await ensureCssFont(fontKey).catch(() => undefined);
    return { type: "text", text: identityText(item, date), fontKey, fontSize: 11, color: item.color ?? "#000000" };
  }
  const spec = item.kind === "stamp" ? stampSpecOf(item) : null;
  const dataUrl = spec ? renderStampSpec(spec) : item.dataUrl!;
  const { w, h } = await imageSize(dataUrl);
  const width = WIDTH[item.kind];
  return { type: "image", dataUrl, width, height: (width * h) / w };
}

interface Props {
  /** Document ouvert et page affichée : aperçu de la paraphe sur toutes les pages. */
  pdf: PDFDocumentProxy | null;
  currentPage: number;
  /** Éléments déjà posés (évités par les paraphes, montrés dans l'aperçu). */
  annotations: Annotation[];
  pageIds: string[];
  /** Polices du document ouvert : la première sert de police par défaut à l'identité. */
  fileFonts: FileFont[];
  onPlace: (parts: PlacePart[]) => void;
  /** Paraphe(s) posée(s) en bas de chaque page, à gauche ou à droite. */
  onInitialsEverywhere: (part: PlacePart, pos: PagePosition | null) => void;
  onClose: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

export function SignDialog({ pdf, currentPage, annotations, pageIds, fileFonts, onPlace, onInitialsEverywhere, onClose, onError, onInfo }: Props) {
  const docFont = fileFonts[0]?.key ?? DEFAULT_FONT_KEY;
  useLocale();
  const [items, setItems] = useState<SignItem[]>([]);
  const [tab, setTab] = useState<SignKind>("signature");
  const [editing, setEditing] = useState(false);
  /** Date écrite par l'identité : aujourd'hui par défaut, modifiable. */
  const [signDate, setSignDate] = useState(isoToday);
  /** Éléments cochés par onglet (plusieurs paraphes possibles, un seul élément ailleurs). */
  const [chosen, setChosen] = useState<Partial<Record<SignKind, string[]>>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}") as Record<string, string | string[]>;
      return Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, Array.isArray(v) ? v : v ? [v] : []]));
    } catch {
      return {};
    }
  });
  const isChosen = (item: SignItem) => !!chosen[item.kind]?.includes(item.id);
  /** Élément en cours de modification (crayon). */
  const [edited, setEdited] = useState<SignItem | null>(null);
  const loadInput = useRef<HTMLInputElement>(null);
  /** Paraphe sur toutes les pages, et sa taille en % (retenues). */
  const [allPages, setAllPages] = useState(() => readPref("paperasse-paraphe-partout") === "1");
  const [initialsScale, setInitialsScale] = useState(() => Number(readPref("paperasse-paraphe-taille")) || 100);
  /** Place des paraphes sur la page (choisie dans l'aperçu, la même sur toutes les pages) ; null = en bas à droite. */
  const [initialsPos, setInitialsPos] = useState<PagePosition | null>(() => {
    try {
      const p = JSON.parse(readPref("paperasse-paraphe-position") ?? "null");
      return p && typeof p.fx === "number" && typeof p.fy === "number" ? p : null;
    } catch {
      return null;
    }
  });
  useEffect(() => writePref("paperasse-paraphe-position", JSON.stringify(initialsPos)), [initialsPos]);
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
  // Les tampons ont leur propre outil : ils ne sont plus posés depuis « Signer ».
  const selection = useMemo(() => sortForStack(items.filter((i) => i.kind !== "stamp" && chosen[i.kind]?.includes(i.id))), [items, chosen]);
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
  const toggle = (item: SignItem) =>
    setChosen((c) => {
      const cur = c[item.kind] ?? [];
      if (cur.includes(item.id)) return { ...c, [item.kind]: cur.filter((id) => id !== item.id) };
      // Plusieurs paraphes (plusieurs signataires) ; un seul élément dans les autres onglets.
      return { ...c, [item.kind]: item.kind === "initials" ? [...cur, item.id] : [item.id] };
    });

  const add = async (fresh: SignItem, remember: boolean) => {
    const known = items.some((i) => i.id === fresh.id);
    // Même nom dans le même onglet : l'autre élément est remplacé.
    const clash = fresh.name ? items.find((i) => i.kind === fresh.kind && i.id !== fresh.id && sameName(i.name, fresh.name)) : undefined;
    const item = clash && !known ? { ...fresh, id: clash.id, createdAt: clash.createdAt } : fresh;
    if (clash && known) await deleteSignItem(clash.id).catch(() => undefined);
    if (remember) await saveSignItem(item).catch(() => onError(t("Enregistrement impossible sur cet appareil (navigation privée ?).")));
    setItems((l) => {
      const rest = clash && known ? l.filter((i) => i.id !== clash.id) : l;
      return rest.some((i) => i.id === item.id) ? rest.map((i) => (i.id === item.id ? item : i)) : [...rest, item];
    });
    if (!known) setChosen((c) => ({ ...c, [item.kind]: item.kind === "initials" ? [...(c.initials ?? []).filter((id) => id !== item.id), item.id] : [item.id] }));
    setEditing(false);
    setEdited(null);
  };

  const remove = async (item: SignItem) => {
    if (!window.confirm(t("Supprimer cet élément ?"))) return;
    await deleteSignItem(item.id).catch(() => undefined);
    setItems((l) => l.filter((i) => i.id !== item.id));
  };

  const chosenInitials = selection.filter((i) => i.kind === "initials");
  const everywhere = allPages && chosenInitials.length > 0;

  /** Paraphe(s) : une image, ou plusieurs côte à côte ; à la taille réglée pour « toutes les pages ». */
  const initialsPart = async (scale: number): Promise<PlacePart> => {
    const parts = (await Promise.all(chosenInitials.map((i) => toPart(i, signDate, docFont)))).flatMap((p) =>
      p.type === "image" ? [{ ...p, width: (p.width * scale) / 100, height: (p.height * scale) / 100 }] : [],
    );
    return parts.length === 1 ? parts[0] : { type: "row", parts };
  };

  // Groupe de paraphes à la taille réglée, pour l'aperçu.
  const [previewPart, setPreviewPart] = useState<PlacePart | null>(null);
  const initialsKey = chosenInitials.map((i) => i.id + (i.dataUrl?.length ?? 0)).join("|");
  useEffect(() => {
    if (!everywhere) return setPreviewPart(null);
    let alive = true;
    initialsPart(initialsScale)
      .then((p) => alive && setPreviewPart(p))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everywhere, initialsKey, initialsScale]);

  const place = async () => {
    try {
      // Paraphes sur toutes les pages tout de suite ; le reste se pose d'un appui sur la page.
      if (everywhere) onInitialsEverywhere(await initialsPart(initialsScale), initialsPos);
      const rest = everywhere ? selection.filter((i) => i.kind !== "initials") : selection;
      const parts: PlacePart[] = [];
      let initialsDone = false;
      for (const i of rest) {
        if (i.kind !== "initials") parts.push(await toPart(i, signDate, docFont));
        else if (!initialsDone) {
          parts.push(await initialsPart(100));
          initialsDone = true;
        }
      }
      if (parts.length) onPlace(parts);
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

  const startEdit = (item: SignItem) => {
    setEdited(item);
    setEditing(true);
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
                setEdited(null);
                setEditing(!items.some((i) => i.kind === tb.kind));
              }}
            >
              <Icon name={tb.icon} size={18} />
              <span>{t(tb.label)}</span>
              {items.some((i) => i.kind === tb.kind && isChosen(i)) && <i className="sign-dot" />}
            </button>
          ))}
        </nav>

        <div className="sign-body">
          {editing ? (
            <Editor key={`${tab}-${edited?.id ?? "new"}`} kind={tab} initial={edited ?? undefined} names={names} existing={items} date={signDate} onDate={setSignDate} fileFonts={fileFonts} docFont={docFont} onSave={add} onCancel={ofTab.length ? () => (setEditing(false), setEdited(null)) : undefined} onError={onError} />
          ) : (
            <>
              <div className="sign-list">
                {ofTab.map((item) => (
                  <div key={item.id} className={`sign-card ${isChosen(item) ? "chosen" : ""}`}>
                    <label>
                      <input type="checkbox" checked={isChosen(item)} onChange={() => toggle(item)} />
                      <Preview item={item} date={signDate} docFont={docFont} />
                    </label>
                    <div className="sign-card-actions">
                      <button className="icon-btn" title={t("Modifier")} onClick={() => startEdit(item)}>
                        <Icon name="pen" size={16} />
                      </button>
                      <button className="icon-btn" title={t("Supprimer")} onClick={() => remove(item)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {tab === "identity" && <DateField value={signDate} onChange={setSignDate} />}
              <div className="modal-row">
                <button onClick={() => setEditing(true)}>
                  <Icon name="plus" size={18} /> {t("Nouveau")}
                </button>
              </div>
              {tab === "initials" && ofTab.length > 1 && <p className="hint">{t("Cochez plusieurs paraphes pour les poser côte à côte (plusieurs signataires).")}</p>}
              {tab === "initials" && chosenInitials.length > 0 && (
                <div className="initials-all">
                  {(() => {
                    const lead = (
                      <label className="check">
                        <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} />
                        {t("Parapher toutes les pages")}
                      </label>
                    );
                    if (!allPages || !pdf || !previewPart) return lead;
                    return (
                      <InitialsPreview
                        lead={lead}
                        extra={
                          <label className="field">
                            <span>{t("Taille : {n} %", { n: initialsScale })}</span>
                            <input type="range" min={30} max={200} step={5} value={initialsScale} onChange={(e) => setInitialsScale(+e.target.value)} />
                          </label>
                        }
                        pdf={pdf}
                        page={Math.min(currentPage, pageIds.length - 1)}
                        pageId={pageIds[Math.min(currentPage, pageIds.length - 1)]}
                        annotations={annotations}
                        part={previewPart}
                        pos={initialsPos}
                        onPos={setInitialsPos}
                      />
                    );
                  })()}
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
                  .filter((label, n, all) => all.indexOf(label) === n)
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

/**
 * Page affichée en miniature avec les éléments déjà posés : on fait glisser
 * la paraphe (ou le groupe) à sa place ; elle évite les éléments existants
 * exactement comme à la pose sur chaque page.
 */
function InitialsPreview({
  pdf,
  page,
  pageId,
  annotations,
  part,
  pos,
  onPos,
  lead,
  extra,
}: {
  /** Case « Parapher toutes les pages », sur la même ligne que le choix gauche / droite. */
  lead: React.ReactNode;
  /** Réglage de taille, sous cette ligne. */
  extra: React.ReactNode;
  pdf: PDFDocumentProxy;
  page: number;
  pageId: string;
  annotations: Annotation[];
  part: PlacePart;
  pos: PagePosition | null;
  onPos: (p: PagePosition) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ s: number; width: number; height: number; obstacles: Box[]; placed: { a: Annotation; box: Box }[] } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; pos: PagePosition } | null>(null);
  const [dragPos, setDragPos] = useState<PagePosition | null>(null);

  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let alive = true;
    (async () => {
      const p = await pdf.getPage(page + 1);
      const base = p.getViewport({ scale: 1 });
      // Seule la moitié basse de la page est montrée, plus grande : c'est là que se posent les paraphes.
      const room = wrap.current?.clientWidth || 340;
      const s = Math.min(room / base.width, 360 / (base.height / 2));
      const vp = p.getViewport({ scale: s * (window.devicePixelRatio || 1) });
      const c = canvas.current;
      if (!alive || !c) return;
      c.width = vp.width;
      c.height = vp.height;
      c.style.width = `${base.width * s}px`;
      c.style.height = `${base.height * s}px`;
      task = p.render({ canvas: c, viewport: vp });
      await task.promise.catch(() => undefined);
      const obstacles = obstaclesOn(annotations, pageId, base);
      const withRect = annotations.filter((a) => a.pageId === pageId && "rect" in a && a.rect);
      if (alive) setView({ s, width: base.width, height: base.height, obstacles, placed: withRect.map((a, k) => ({ a, box: obstacles[k] })) });
    })().catch(() => undefined);
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [pdf, page, pageId, annotations]);

  const w = partWidth(part);
  const h = partHeight(part);
  const images = part.type === "row" ? part.parts : part.type === "image" ? [part] : [];
  const size = view ? { width: view.width, height: view.height } : null;
  const current = dragPos ?? pos ?? (size ? cornerPosition("right", w, h, size) : null);
  // Pendant le glissement : là où est le doigt ; ensuite : la place réelle (décalée si occupée).
  const box = size && current ? (dragPos ? boxAt(current, w, h, size) : freeSpot(boxAt(current, w, h, size), view!.obstacles, size, current.fx > 0.5 ? "left" : "right")) : null;
  const preset = (side: "left" | "right") => size && onPos(cornerPosition(side, w, h, size));
  const near = (side: "left" | "right") => {
    if (!size || !current) return false;
    const c = cornerPosition(side, w, h, size);
    return Math.abs(c.fx - current.fx) < 0.01 && Math.abs(c.fy - current.fy) < 0.01;
  };

  return (
    <div className="initials-place" ref={wrap}>
      <div className="initials-head">
        {lead}
        <div className="seg" role="radiogroup" aria-label={t("Position")}>
          {(["left", "right"] as const).map((side) => (
            <button key={side} role="radio" aria-checked={near(side)} className={near(side) ? "active" : ""} onClick={() => preset(side)}>
              {side === "left" ? t("À gauche") : t("À droite")}
            </button>
          ))}
        </div>
      </div>
      {extra}
      <p className="hint">{t("Faites glisser la paraphe dans l'aperçu pour choisir sa place : elle sera au même endroit sur chaque page, à côté des éléments déjà posés.")}</p>
      <div className="initials-preview half" style={view ? { width: view.width * view.s, height: (view.height / 2) * view.s } : undefined}>
        <canvas ref={canvas} />
        {view &&
          view.placed.map(({ a, box: b }, n) => {
            const style = { left: b[0] * view.s, top: (b[1] - view.height / 2) * view.s, width: (b[2] - b[0]) * view.s, height: (b[3] - b[1]) * view.s };
            return a.kind === "image" ? <img key={n} className="initials-existing" src={a.dataUrl} alt="" style={style} /> : <span key={n} className="initials-existing box" style={style} />;
          })}
        {view && box && (
          <div
            className={`initials-group ${dragPos ? "dragging" : ""}`}
            style={{ left: box[0] * view.s, top: (box[1] - view.height / 2) * view.s, width: w * view.s, height: h * view.s, gap: 6 * view.s }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ x: e.clientX, y: e.clientY, pos: { fx: (box[0] + box[2]) / 2 / view.width, fy: (box[1] + box[3]) / 2 / view.height } });
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              // Reste dans la moitié basse affichée.
              const fy = drag.pos.fy + (e.clientY - drag.y) / (view.s * view.height);
              setDragPos({ fx: drag.pos.fx + (e.clientX - drag.x) / (view.s * view.width), fy: Math.max(0.5 + h / 2 / view.height, fy) });
            }}
            onPointerUp={() => {
              if (dragPos) {
                const b = boxAt(dragPos, w, h, size!);
                onPos({ fx: (b[0] + b[2]) / 2 / view.width, fy: (b[1] + b[3]) / 2 / view.height });
              }
              setDrag(null);
              setDragPos(null);
            }}
            onPointerCancel={() => {
              setDrag(null);
              setDragPos(null);
            }}
          >
            {images.map((img, n) => (
              <img key={n} src={img.dataUrl} alt="" draggable={false} style={{ width: img.width * view.s }} />
            ))}
          </div>
        )}
      </div>
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
  const stampUrl = useMemo(() => (item.kind === "stamp" && item.stamp ? renderStampSpec(stampSpecOf(item)!, 1) : null), [item]);
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
  initial,
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
  /** Élément à modifier (crayon) ; sinon création. */
  initial?: SignItem;
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
  const modes: Mode[] = kind === "identity" || kind === "mention" ? ["type", "draw", "import"] : ["draw", "type", "import"];
  // Modification : on rouvre l'élément dans le mode où il a été créé (un dessin se montre comme une image, à redessiner au besoin).
  const initialText = initial?.stamp?.label ?? initial?.text ?? "";
  const initialMode: Mode = !initial ? modes[0] : initialText ? "type" : "import";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [color, setColor] = useState(initial?.stamp?.color ?? initial?.color ?? (kind === "stamp" ? STAMP_COLORS[0] : kind === "identity" ? "#000000" : INK[0]));
  const [text, setText] = useState(initialText);
  const [city, setCity] = useState(initial?.city ?? "");
  const [withDate, setWithDate] = useState(initial?.withDate ?? initial?.stamp?.withDate ?? true);
  const scriptFont = (kind === "signature" || kind === "initials") && initial?.fontKey ? initial.fontKey : null;
  const [font, setFont] = useState(scriptFont ?? SCRIPT_FONTS[0]);
  const [fontsReady, setFontsReady] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [imported, setImported] = useState<string | null>(initialMode === "import" ? (initial?.dataUrl ?? null) : null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState(initial?.name ?? "");
  /** Identité : police choisie explicitement (sinon celle du document). */
  const [identityFont, setIdentityFont] = useState<string | null>(kind === "identity" ? (initial?.fontKey ?? null) : null);
  /** Signature / paraphe écrite : police choisie dans la liste complète (6e case). */
  const [otherFont, setOtherFont] = useState<string | null>(scriptFont && !SCRIPT_FONTS.includes(scriptFont) ? scriptFont : null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Changer de mode repart d'une saisie vide (sauf à l'ouverture d'un élément à modifier).
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    setText("");
    setImported(null);
    setDrawn(false);
  }, [mode]);

  // Polices manuscrites chargées pour l'aperçu de l'écriture au clavier.
  useEffect(() => {
    if (mode !== "type" || kind === "identity" || kind === "stamp") return;
    const list = kind === "mention" ? [MENTION_FONT] : SCRIPT_FONTS;
    Promise.all(list.map((k) => ensureCssFont(k).catch(() => undefined))).then(() => setFontsReady((n) => n + 1));
  }, [mode, kind]);

  const base: SignItem = { id: initial?.id ?? newId("sign"), kind, createdAt: initial?.createdAt ?? Date.now(), ...(name.trim() ? { name: name.trim() } : {}) };
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
      // Signature / paraphe écrite : texte et police gardés pour pouvoir la modifier plus tard.
      const png = await renderScript(text.trim(), font, color);
      if (png) onSave({ ...base, dataUrl: png, color, text: text.trim(), fontKey: font }, remember);
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
          <p className="hint">
            {kind === "initials"
              ? t("Tracez vos initiales dans le cadre.")
              : kind === "mention"
                ? t("Écrivez la mention dans le cadre.")
                : kind === "identity"
                  ? t("Écrivez votre nom (et la date si besoin) dans le cadre.")
                  : t("Signez dans le cadre.")}
          </p>
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

