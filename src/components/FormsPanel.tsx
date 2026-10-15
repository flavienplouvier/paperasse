import { useEffect, useState } from "react";
import { readFormFields, type FormField, type FormValues } from "../lib/forms";
import { DEFAULT_FONT_KEY } from "../lib/fonts";
import { FontPicker } from "./FontPicker";

interface Props {
  bytes: Uint8Array;
  editable: boolean;
  onApply: (values: FormValues, fontKey: string | undefined) => Promise<void>;
  onError: (msg: string) => void;
}

export function FormsPanel({ bytes, editable, onApply, onError }: Props) {
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [fontKey, setFontKey] = useState(DEFAULT_FONT_KEY);
  const [customFont, setCustomFont] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!editable) return;
    readFormFields(bytes)
      .then((f) => {
        if (!alive) return;
        setFields(f);
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
      })
      .catch(() => alive && setFields([]));
    return () => {
      alive = false;
    };
  }, [bytes, editable]);

  if (!editable) return <p className="hint pad">Les formulaires de ce PDF protégé ne peuvent pas être modifiés.</p>;
  if (!fields) return <p className="hint pad">Lecture du formulaire…</p>;
  if (!fields.length)
    return (
      <p className="hint pad">
        Ce PDF ne contient pas de champs de formulaire. Utilisez l'outil Texte pour écrire n'importe où sur la page.
      </p>
    );

  const set = (name: string, v: string | boolean) => setValues((old) => ({ ...old, [name]: v }));

  return (
    <form
      className="forms-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(values, customFont ? fontKey : undefined).catch((err: Error) => onError(err.message));
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className={`field ${f.kind === "checkbox" ? "inline" : ""}`}>
          {f.kind === "checkbox" ? (
            <input type="checkbox" disabled={f.readOnly} checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
          ) : null}
          <span className="field-name">{f.name}</span>
          {f.kind === "text" &&
            (f.multiline ? (
              <textarea disabled={f.readOnly} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} />
            ) : (
              <input disabled={f.readOnly} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} />
            ))}
          {(f.kind === "choice" || f.kind === "radio") && (
            <select disabled={f.readOnly} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
        </label>
      ))}
      <label className="field inline">
        <input type="checkbox" checked={customFont} onChange={(e) => setCustomFont(e.target.checked)} /> Choisir la police des champs
      </label>
      {customFont && <FontPicker value={fontKey} onChange={setFontKey} onError={onError} />}
      <button className="primary" type="submit">
        Appliquer au document
      </button>
    </form>
  );
}
