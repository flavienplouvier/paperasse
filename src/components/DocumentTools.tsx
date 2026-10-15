import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import {
  addHeaderFooter,
  addPageNumbers,
  addWatermark,
  type HAlign,
  type VAlign,
} from "../lib/pageDecor";
import { Icon } from "./Icon";

export type DocTab = "numbers" | "headers" | "watermark" | "properties";

interface Props {
  bytes: Uint8Array;
  initialTab: DocTab;
  onApply: (label: string, transform: (bytes: Uint8Array) => Promise<Uint8Array>) => Promise<void>;
  onClose: () => void;
}

const TABS: { id: DocTab; label: string }[] = [
  { id: "numbers", label: "Numéros de page" },
  { id: "headers", label: "En-tête / pied" },
  { id: "watermark", label: "Filigrane" },
  { id: "properties", label: "Propriétés" },
];

/** Outils appliqués à tout le document (numérotation, en-tête/pied, filigrane, métadonnées). */
export function DocumentTools({ bytes, initialTab, onApply, onClose }: Props) {
  const [tab, setTab] = useState<DocTab>(initialTab);
  const [busy, setBusy] = useState(false);

  // Numérotation
  const [format, setFormat] = useState("{page} / {total}");
  const [vertical, setVertical] = useState<VAlign>("bottom");
  const [horizontal, setHorizontal] = useState<HAlign>("center");
  const [start, setStart] = useState(1);
  const [skipFirst, setSkipFirst] = useState(false);

  // En-tête / pied
  const [header, setHeader] = useState<[string, string, string]>(["", "{titre}", ""]);
  const [footer, setFooter] = useState<[string, string, string]>(["{date}", "", "Page {page} / {total}"]);

  // Filigrane
  const [wmText, setWmText] = useState("CONFIDENTIEL");
  const [wmColor, setWmColor] = useState("#c62828");
  const [wmOpacity, setWmOpacity] = useState(0.18);
  const [wmDiagonal, setWmDiagonal] = useState(true);

  // Propriétés
  const [props, setProps] = useState({ title: "", author: "", subject: "", keywords: "" });
  useEffect(() => {
    PDFDocument.load(bytes, { updateMetadata: false })
      .then((d) =>
        setProps({
          title: d.getTitle() ?? "",
          author: d.getAuthor() ?? "",
          subject: d.getSubject() ?? "",
          keywords: d.getKeywords() ?? "",
        }),
      )
      .catch(() => undefined);
  }, [bytes]);

  const [size, setSize] = useState(10);
  const [textColor, setTextColor] = useState("#333333");

  const apply = async () => {
    setBusy(true);
    try {
      if (tab === "numbers") {
        await onApply("Numérotation…", (b) =>
          addPageNumbers(b, { format, vertical, horizontal, start, size, color: textColor, margin: 28, skipFirst }),
        );
      } else if (tab === "headers") {
        await onApply("En-tête et pied de page…", (b) =>
          addHeaderFooter(b, { header, footer, size, color: textColor, margin: 24, skipFirst }),
        );
      } else if (tab === "watermark") {
        await onApply("Filigrane…", (b) =>
          addWatermark(b, { text: wmText, size: 96, color: wmColor, opacity: wmOpacity, diagonal: wmDiagonal, skipFirst }),
        );
      } else {
        await onApply("Propriétés…", async (b) => {
          const d = await PDFDocument.load(b, { updateMetadata: false });
          d.setTitle(props.title);
          d.setAuthor(props.author);
          d.setSubject(props.subject);
          d.setKeywords(props.keywords.split(/[,;]\s*/).filter(Boolean));
          return d.save();
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const triple = (value: [string, string, string], set: (v: [string, string, string]) => void, label: string) => (
    <div className="field">
      {label}
      <div className="triple">
        {(["Gauche", "Centre", "Droite"] as const).map((pos, i) => (
          <input
            key={pos}
            aria-label={`${label} — ${pos}`}
            placeholder={pos}
            value={value[i]}
            onChange={(e) => {
              const next = [...value] as [string, string, string];
              next[i] = e.target.value;
              set(next);
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Outils du document">
        <header>
          <h2>Outils du document</h2>
          <button className="icon-btn" onClick={onClose} title="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="tabs inline-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="dialog-body">
          {tab === "numbers" && (
            <>
              <label className="field">
                Format
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="{page}">1</option>
                  <option value="{page} / {total}">1 / 12</option>
                  <option value="Page {page}">Page 1</option>
                  <option value="Page {page} sur {total}">Page 1 sur 12</option>
                  <option value="- {page} -">- 1 -</option>
                </select>
              </label>
              <div className="field-row">
                <label className="field">
                  Position
                  <select value={vertical} onChange={(e) => setVertical(e.target.value as VAlign)}>
                    <option value="bottom">En bas</option>
                    <option value="top">En haut</option>
                  </select>
                </label>
                <label className="field">
                  Alignement
                  <select value={horizontal} onChange={(e) => setHorizontal(e.target.value as HAlign)}>
                    <option value="left">À gauche</option>
                    <option value="center">Au centre</option>
                    <option value="right">À droite</option>
                  </select>
                </label>
                <label className="field">
                  Premier numéro
                  <input type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, +e.target.value || 0))} />
                </label>
              </div>
            </>
          )}

          {tab === "headers" && (
            <>
              {triple(header, setHeader, "En-tête")}
              {triple(footer, setFooter, "Pied de page")}
              <p className="hint">Variables : {"{page}"}, {"{total}"}, {"{date}"}, {"{titre}"}.</p>
            </>
          )}

          {tab === "watermark" && (
            <>
              <label className="field">
                Texte du filigrane
                <input value={wmText} onChange={(e) => setWmText(e.target.value)} />
              </label>
              <div className="field-row">
                <label className="field">
                  Couleur
                  <input type="color" value={wmColor} onChange={(e) => setWmColor(e.target.value)} />
                </label>
                <label className="field">
                  Opacité : {Math.round(wmOpacity * 100)} %
                  <input type="range" min={0.05} max={0.6} step={0.01} value={wmOpacity} onChange={(e) => setWmOpacity(+e.target.value)} />
                </label>
              </div>
              <label className="field inline">
                <input type="checkbox" checked={wmDiagonal} onChange={(e) => setWmDiagonal(e.target.checked)} /> En diagonale
              </label>
            </>
          )}

          {tab === "properties" && (
            <>
              {(
                [
                  ["title", "Titre"],
                  ["author", "Auteur"],
                  ["subject", "Sujet"],
                  ["keywords", "Mots-clés (séparés par des virgules)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="field">
                  {label}
                  <input value={props[key]} onChange={(e) => setProps({ ...props, [key]: e.target.value })} />
                </label>
              ))}
            </>
          )}

          {(tab === "numbers" || tab === "headers") && (
            <div className="field-row">
              <label className="field">
                Taille : {size} pt
                <input type="range" min={6} max={20} step={0.5} value={size} onChange={(e) => setSize(+e.target.value)} />
              </label>
              <label className="field">
                Couleur
                <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} />
              </label>
            </div>
          )}
          {tab !== "properties" && (
            <label className="field inline">
              <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> Ne rien ajouter sur la première page
            </label>
          )}
        </div>

        <div className="modal-row">
          <span className="hint">Modification annulable avec Ctrl+Z.</span>
          <span className="spacer" />
          <button onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy} onClick={apply}>
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
