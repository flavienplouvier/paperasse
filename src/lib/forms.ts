import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import { compatFontkit, withPreferredFont } from "./fontkitCompat";
import { fontBytes, getFont } from "./fonts";

export type FormField =
  | { kind: "text"; name: string; value: string; multiline: boolean; readOnly: boolean }
  | { kind: "checkbox"; name: string; value: boolean; readOnly: boolean }
  | { kind: "choice"; name: string; value: string; options: string[]; readOnly: boolean }
  | { kind: "radio"; name: string; value: string; options: string[]; readOnly: boolean };

export type FormValues = Record<string, string | boolean>;

export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fields: FormField[] = [];
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    try {
      if (f instanceof PDFTextField) {
        fields.push({ kind: "text", name, value: f.getText() ?? "", multiline: f.isMultiline(), readOnly });
      } else if (f instanceof PDFCheckBox) {
        fields.push({ kind: "checkbox", name, value: f.isChecked(), readOnly });
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
        fields.push({ kind: "choice", name, value: f.getSelected()[0] ?? "", options: f.getOptions(), readOnly });
      } else if (f instanceof PDFRadioGroup) {
        fields.push({ kind: "radio", name, value: f.getSelected() ?? "", options: f.getOptions(), readOnly });
      }
    } catch {
      /* champ mal formé : ignoré plutôt que de bloquer tout le formulaire */
    }
  }
  return fields;
}

/**
 * Écrit les valeurs dans le PDF et régénère l'apparence des champs.
 * `fontKey` permet d'utiliser une police couvrant des caractères hors latin.
 */
export async function fillForm(bytes: Uint8Array, values: FormValues, fontKey?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.registerFontkit(compatFontkit);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    if (field instanceof PDFTextField) field.setText(String(value));
    else if (field instanceof PDFCheckBox) (value ? field.check() : field.uncheck());
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (value) field.select(String(value));
    } else if (field instanceof PDFRadioGroup && value) field.select(String(value));
  }
  if (fontKey) {
    const entry = getFont(fontKey);
    const font = entry.standard
      ? await doc.embedFont(entry.standard)
      : await withPreferredFont(entry.postscriptName, async () =>
          doc.embedFont(await fontBytes(fontKey), { subset: true }),
        );
    form.updateFieldAppearances(font);
  }
  return doc.save();
}
