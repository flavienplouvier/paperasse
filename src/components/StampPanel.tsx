import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { importSignature } from "./DrawPad";
import { t, useLocale } from "../i18n";
import { newId } from "../lib/types";
import { deleteSignItem, listSignItems, saveSignItem, type SignItem } from "../lib/signatures";
import { STAMPS, STAMP_FONTS, STAMP_SHAPES, preloadLogo, renderStampSpec, type StampSpec } from "../lib/stamp";

/**
 * Outil Tampon : modèles prêts à l'emploi, création (rectangle, rond avec
 * texte sur le pourtour et logo au centre, ovale), encre usée, inclinaison,
 * et « Mes tampons » enregistrés sur l'appareil.
 */

const KEY = "paperasse-tampon";
const INKS = ["#c62828", "#1d5fbf", "#1f8a4c", "#6b2fa0", "#222222"];
const DEFAULT: StampSpec = { shape: "rect", text: "", ring: "", ringBottom: "", color: "#c62828", withDate: true, wear: 0.35, angle: -4, font: "block", double: false };

/** Ancien format de tampon enregistré ({ label, color, withDate }) → description complète. */
export function stampSpecOf(item: SignItem): StampSpec | null {
  const s = item.stamp as (Partial<StampSpec> & { label?: string }) | undefined;
  if (!s) return null;
  return { ...DEFAULT, wear: 0, angle: 0, ...s, text: s.text ?? s.label ?? "" } as StampSpec;
}

function loadSpec(): StampSpec {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT;
  }
}

export function StampPanel({ onStamp, onError }: { onStamp: (dataUrl: string) => void; onError: (msg: string) => void }) {
  useLocale();
  const [spec, setSpec] = useState<StampSpec>(loadSpec);
  const [saved, setSaved] = useState<SignItem[]>([]);
  const [logos, setLogos] = useState(0);
  const [name, setName] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<StampSpec>) => setSpec((s) => ({ ...s, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(spec));
    } catch {
      /* stockage plein ou indisponible */
    }
  }, [spec]);

  useEffect(() => {
    listSignItems()
      .then((l) => setSaved(l.filter((i) => i.kind === "stamp")))
      .catch(() => undefined);
  }, []);

  // Logos décodés avant le rendu (qui reste synchrone).
  useEffect(() => {
    const urls = [spec.logo, ...saved.map((i) => stampSpecOf(i)?.logo)].filter((u): u is string => !!u);
    Promise.all(urls.map((u) => preloadLogo(u).catch(() => undefined))).then(() => setLogos((n) => n + 1));
  }, [spec.logo, saved]);

  const preview = useMemo(() => renderStampSpec(spec, 1.2), [spec, logos]);
  const presets = useMemo(
    () => STAMPS.map((s) => ({ ...s, url: renderStampSpec({ ...spec, text: t(s.label), color: s.color, logo: undefined, ring: spec.shape === "round" ? spec.ring : "", ringBottom: spec.shape === "round" ? spec.ringBottom : "" }, 0.5) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.shape, spec.wear, spec.angle, spec.font, spec.double, spec.withDate, spec.ring, spec.ringBottom],
  );
  const mine = useMemo(() => saved.map((i) => ({ item: i, url: renderStampSpec(stampSpecOf(i)!, 0.5) })), [saved, logos]);

  const use = (s: StampSpec) => onStamp(renderStampSpec(s, 3));

  const save = async () => {
    const item: SignItem = { id: newId("sign"), kind: "stamp", createdAt: Date.now(), stamp: { ...spec } as SignItem["stamp"], ...(name.trim() ? { name: name.trim() } : {}) };
    // Même nom : le tampon enregistré est remplacé.
    const same = name.trim() ? saved.find((i) => i.name?.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    if (same) item.id = same.id;
    try {
      await saveSignItem(item);
      setSaved((l) => (same ? l.map((i) => (i.id === same.id ? item : i)) : [...l, item]));
      setName("");
    } catch {
      onError(t("Enregistrement impossible sur cet appareil (navigation privée ?)."));
    }
  };

  const remove = async (item: SignItem) => {
    if (!window.confirm(t("Supprimer cet élément ?"))) return;
    await deleteSignItem(item.id).catch(() => undefined);
    setSaved((l) => l.filter((i) => i.id !== item.id));
  };

  return (
    <div className="stamp-panel">
      {mine.length > 0 && (
        <section>
          <h4>{t("Mes tampons")}</h4>
          <div className="stamp-gallery">
            {mine.map(({ item, url }) => (
              <div key={item.id} className="stamp-tile">
                <button title={item.name ?? t("Poser ce tampon")} onClick={() => use(stampSpecOf(item)!)}>
                  <img src={url} alt="" />
                  {item.name && <small>{item.name}</small>}
                </button>
                <div className="stamp-tile-actions">
                  <button className="icon-btn" title={t("Modifier")} onClick={() => setSpec(stampSpecOf(item)!)}>
                    <Icon name="pen" size={14} />
                  </button>
                  <button className="icon-btn" title={t("Supprimer")} onClick={() => remove(item)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h4>{t("Modèles")}</h4>
        <div className="stamp-gallery">
          {presets.map((p) => (
            <div key={p.label} className="stamp-tile">
              <button
                title={t(p.label)}
                onClick={() => {
                  const next = { ...spec, text: t(p.label), color: p.color, logo: undefined };
                  setSpec(next);
                  use(next);
                }}
              >
                <img src={p.url} alt={t(p.label)} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="stamp-designer">
        <h4>{t("Créer un tampon")}</h4>
        <div className="seg" role="radiogroup" aria-label={t("Forme")}>
          {STAMP_SHAPES.map((s) => (
            <button key={s.id} role="radio" aria-checked={spec.shape === s.id} className={spec.shape === s.id ? "active" : ""} onClick={() => set({ shape: s.id })}>
              {t(s.label)}
            </button>
          ))}
        </div>
        {spec.shape === "round" && (
          <>
            <label className="field">
              <span>{t("Texte du pourtour (haut)")}</span>
              <input value={spec.ring ?? ""} maxLength={40} placeholder={t("Ex. Société Martin")} onChange={(e) => set({ ring: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("Texte du pourtour (bas)")}</span>
              <input value={spec.ringBottom ?? ""} maxLength={40} placeholder={t("Ex. Lyon")} onChange={(e) => set({ ringBottom: e.target.value })} />
            </label>
          </>
        )}
        <label className="field">
          <span>{spec.shape === "round" ? t("Texte du centre") : t("Texte")}</span>
          <textarea rows={2} value={spec.text} maxLength={80} placeholder={t("Ex. : Bon pour accord")} onChange={(e) => set({ text: e.target.value })} />
        </label>
        <div className="modal-row">
          {spec.logo ? (
            <>
              <img className="stamp-logo" src={spec.logo} alt="" />
              <button onClick={() => set({ logo: undefined })}>{t("Retirer le logo")}</button>
            </>
          ) : (
            <button onClick={() => logoInput.current?.click()}>
              <Icon name="image" size={16} /> {t("Logo au centre")}
            </button>
          )}
          <input
            ref={logoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                set({ logo: await importSignature(f, true) });
              } catch (err) {
                onError(err instanceof Error ? err.message : t("Image illisible."));
              }
            }}
          />
        </div>
        <label className="field inline">
          <input type="checkbox" checked={spec.withDate} onChange={(e) => set({ withDate: e.target.checked })} /> {t("Ajouter la date du jour")}
        </label>
        {spec.shape !== "round" && (
          <label className="field inline">
            <input type="checkbox" checked={!!spec.double} onChange={(e) => set({ double: e.target.checked })} /> {t("Double cadre")}
          </label>
        )}
        <div className="swatches">
          {INKS.map((c) => (
            <button key={c} className={`swatch ${spec.color === c ? "active" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={t("Couleur {color}", { color: c })} />
          ))}
          <input type="color" value={spec.color} title={t("Autre couleur")} onChange={(e) => set({ color: e.target.value })} />
        </div>
        <div className="seg" role="radiogroup" aria-label={t("Police")}>
          {STAMP_FONTS.map((f) => (
            <button key={f.id} role="radio" aria-checked={(spec.font ?? "block") === f.id} className={(spec.font ?? "block") === f.id ? "active" : ""} onClick={() => set({ font: f.id })}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t("Encre usée : {n} %", { n: Math.round(spec.wear * 100) })}</span>
          <input type="range" min={0} max={1} step={0.05} value={spec.wear} onChange={(e) => set({ wear: +e.target.value })} />
        </label>
        <label className="field">
          <span>{t("Inclinaison : {n}°", { n: spec.angle })}</span>
          <input type="range" min={-15} max={15} step={1} value={spec.angle} onChange={(e) => set({ angle: +e.target.value })} />
        </label>
        <div className="stamp-preview">
          <img src={preview} alt={t("Aperçu")} />
        </div>
        <button className="primary" onClick={() => use(spec)}>
          <Icon name="stamp" size={16} /> {t("Poser ce tampon")}
        </button>
        <div className="modal-row">
          <input className="stamp-name" value={name} maxLength={64} placeholder={t("Nom (facultatif), ex. Pro")} onChange={(e) => setName(e.target.value)} />
          <button onClick={save}>{t("Enregistrer dans mes tampons")}</button>
        </div>
        <p className="hint">{t("Choisissez un tampon, puis touchez la page à l'endroit où le poser.")}</p>
      </section>
    </div>
  );
}
