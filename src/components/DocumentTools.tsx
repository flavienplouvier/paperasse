import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import {
  addHeaderFooter,
  addPageNumbers,
  addWatermark,
  type HAlign,
  type VAlign,
} from "../lib/pageDecor";
import { COMPRESSION_LEVELS, compressPdf, formatSize, type CompressionLevel } from "../lib/compress";
import { canvasEncoder } from "../lib/imageEncoder";
import { Icon } from "./Icon";
import { msg, t, tn, useLocale } from "../i18n";

export type DocTab = "numbers" | "headers" | "watermark" | "properties" | "compress";

interface Props {
  bytes: Uint8Array;
  initialTab: DocTab;
  onApply: (
    label: string,
    transform: (bytes: Uint8Array) => Promise<Uint8Array | { bytes: Uint8Array; message: string }>,
  ) => Promise<void>;
  onClose: () => void;
}

const TABS: { id: DocTab; label: string }[] = [
  { id: "numbers", label: msg("Numéros de page") },
  { id: "headers", label: msg("En-tête / pied") },
  { id: "watermark", label: msg("Filigrane") },
  { id: "properties", label: msg("Propriétés") },
  { id: "compress", label: msg("Compresser") },
];

/** Outils appliqués à tout le document (numérotation, en-tête/pied, filigrane, métadonnées). */
export function DocumentTools({ bytes, initialTab, onApply, onClose }: Props) {
  useLocale();
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
  const [footer, setFooter] = useState<[string, string, string]>(() => ["{date}", "", t("Page {page} / {total}")]);

  // Filigrane
  const [wmText, setWmText] = useState(() => t("CONFIDENTIEL"));
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

  // Compression
  const [level, setLevel] = useState<CompressionLevel>("balanced");

  const [size, setSize] = useState(10);
  const [textColor, setTextColor] = useState("#333333");

  const apply = async () => {
    setBusy(true);
    try {
      if (tab === "numbers") {
        await onApply(t("Numérotation…"), (b) =>
          addPageNumbers(b, { format, vertical, horizontal, start, size, color: textColor, margin: 28, skipFirst }),
        );
      } else if (tab === "headers") {
        await onApply(t("En-tête et pied de page…"), (b) =>
          addHeaderFooter(b, { header, footer, size, color: textColor, margin: 24, skipFirst }),
        );
      } else if (tab === "watermark") {
        await onApply(t("Filigrane…"), (b) =>
          addWatermark(b, { text: wmText, size: 96, color: wmColor, opacity: wmOpacity, diagonal: wmDiagonal, skipFirst }),
        );
      } else if (tab === "compress") {
        await onApply(t("Compression…"), async (b) => {
          const { bytes: out, report } = await compressPdf(b, level, canvasEncoder);
          if (report.after >= report.before) {
            return { bytes: b, message: t("Ce PDF est déjà bien compressé : taille inchangée ({size}).", { size: formatSize(report.before) }) };
          }
          const pct = Math.round((1 - report.after / report.before) * 100);
          const imgs = report.images ? ", " + tn("{n} image optimisée", "{n} images optimisées", report.images) : "";
          return {
            bytes: out,
            message: t("PDF compressé : {before} → {after} (−{pct} %){images}. Ctrl+Z pour annuler.", {
              before: formatSize(report.before),
              after: formatSize(report.after),
              pct,
              images: imgs,
            }),
          };
        });
      } else {
        await onApply(t("Propriétés…"), async (b) => {
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
        {[msg("Gauche"), msg("Centre"), msg("Droite")].map((pos, i) => (
          <input
            key={pos}
            aria-label={`${label} — ${t(pos)}`}
            placeholder={t(pos)}
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
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Outils du document")}>
        <header>
          <h2>{t("Outils du document")}</h2>
          <button className="icon-btn" onClick={onClose} title={t("Fermer")}>
            <Icon name="close" />
          </button>
        </header>
        <div className="tabs inline-tabs" role="tablist">
          {TABS.map((tb) => (
            <button key={tb.id} className={tab === tb.id ? "active" : ""} onClick={() => setTab(tb.id)}>
              {t(tb.label)}
            </button>
          ))}
        </div>

        <div className="dialog-body">
          {tab === "numbers" && (
            <>
              <label className="field">
                {t("Format")}
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="{page}">1</option>
                  <option value="{page} / {total}">1 / 12</option>
                  <option value={t("Page {page}")}>{t("Page {page}", { page: 1 })}</option>
                  <option value={t("Page {page} sur {total}")}>{t("Page {page} sur {total}", { page: 1, total: 12 })}</option>
                  <option value="- {page} -">- 1 -</option>
                </select>
              </label>
              <div className="field-row">
                <label className="field">
                  {t("Position")}
                  <select value={vertical} onChange={(e) => setVertical(e.target.value as VAlign)}>
                    <option value="bottom">{t("En bas")}</option>
                    <option value="top">{t("En haut")}</option>
                  </select>
                </label>
                <label className="field">
                  {t("Alignement")}
                  <select value={horizontal} onChange={(e) => setHorizontal(e.target.value as HAlign)}>
                    <option value="left">{t("À gauche")}</option>
                    <option value="center">{t("Au centre")}</option>
                    <option value="right">{t("À droite")}</option>
                  </select>
                </label>
                <label className="field">
                  {t("Premier numéro")}
                  <input type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, +e.target.value || 0))} />
                </label>
              </div>
            </>
          )}

          {tab === "headers" && (
            <>
              {triple(header, setHeader, t("En-tête"))}
              {triple(footer, setFooter, t("Pied de page"))}
              <p className="hint">{t("Variables : {list}.", { list: "{page}, {total}, {date}, {titre}" })}</p>
            </>
          )}

          {tab === "watermark" && (
            <>
              <label className="field">
                {t("Texte du filigrane")}
                <input value={wmText} onChange={(e) => setWmText(e.target.value)} />
              </label>
              <div className="field-row">
                <label className="field">
                  {t("Couleur")}
                  <input type="color" value={wmColor} onChange={(e) => setWmColor(e.target.value)} />
                </label>
                <label className="field">
                  {t("Opacité : {n} %", { n: Math.round(wmOpacity * 100) })}
                  <input type="range" min={0.05} max={0.6} step={0.01} value={wmOpacity} onChange={(e) => setWmOpacity(+e.target.value)} />
                </label>
              </div>
              <label className="field inline">
                <input type="checkbox" checked={wmDiagonal} onChange={(e) => setWmDiagonal(e.target.checked)} /> {t("En diagonale")}
              </label>
            </>
          )}

          {tab === "properties" && (
            <>
              {(
                [
                  ["title", msg("Titre")],
                  ["author", msg("Auteur")],
                  ["subject", msg("Sujet")],
                  ["keywords", msg("Mots-clés (séparés par des virgules)")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="field">
                  {t(label)}
                  <input value={props[key]} onChange={(e) => setProps({ ...props, [key]: e.target.value })} />
                </label>
              ))}
            </>
          )}

          {tab === "compress" && (
            <>
              <p className="hint">{t("Taille actuelle : {size}. Tout se fait sur cet appareil.", { size: formatSize(bytes.length) })}</p>
              {(Object.keys(COMPRESSION_LEVELS) as CompressionLevel[]).map((id) => (
                <label key={id} className="field inline choice">
                  <input type="radio" name="compression" checked={level === id} onChange={() => setLevel(id)} />
                  <span>
                    <strong>{t(COMPRESSION_LEVELS[id].label)}</strong>
                    <br />
                    <span className="hint">{t(COMPRESSION_LEVELS[id].detail)}</span>
                  </span>
                </label>
              ))}
            </>
          )}

          {(tab === "numbers" || tab === "headers") && (
            <div className="field-row">
              <label className="field">
                {t("Taille : {size} pt", { size })}
                <input type="range" min={6} max={20} step={0.5} value={size} onChange={(e) => setSize(+e.target.value)} />
              </label>
              <label className="field">
                {t("Couleur")}
                <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} />
              </label>
            </div>
          )}
          {tab !== "properties" && tab !== "compress" && (
            <label className="field inline">
              <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> {t("Ne rien ajouter sur la première page")}
            </label>
          )}
        </div>

        <div className="modal-row modal-actions">
          <span className="hint">{t("Modification annulable avec Ctrl+Z.")}</span>
          <span className="spacer" />
          <button onClick={onClose}>{t("Annuler")}</button>
          <button className="primary" disabled={busy} onClick={apply}>
            {t("Appliquer")}
          </button>
        </div>
      </div>
    </div>
  );
}
