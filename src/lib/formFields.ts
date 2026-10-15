import { PDFDocument, type PDFPage, rgb } from "pdf-lib";
import type { FieldAnnotation } from "./types";

/** Nom libre de tout conflit avec les champs déjà présents dans le formulaire. */
export function uniqueFieldName(doc: PDFDocument, wanted: string): string {
  const form = doc.getForm();
  const base = wanted.trim().replace(/[.\s]+/g, "_") || "champ";
  let name = base;
  for (let i = 2; form.getFieldMaybe(name); i++) name = `${base}_${i}`;
  return name;
}

/**
 * Crée un vrai champ de formulaire PDF (AcroForm) à l'emplacement prévu :
 * il pourra être rempli dans Paperasse, Acrobat, un navigateur…
 */
export function createFormField(doc: PDFDocument, page: PDFPage, a: FieldAnnotation): string {
  const form = doc.getForm();
  const name = uniqueFieldName(doc, a.name);
  const [x1, y1, x2, y2] = a.rect;
  const box = {
    x: x1,
    y: y1,
    width: Math.max(4, x2 - x1),
    height: Math.max(4, y2 - y1),
    borderColor: rgb(0.55, 0.58, 0.66),
    borderWidth: 1,
    backgroundColor: rgb(1, 1, 1),
  };
  if (a.fieldType === "checkbox") {
    form.createCheckBox(name).addToPage(page, box);
  } else if (a.fieldType === "dropdown") {
    const field = form.createDropdown(name);
    const options = (a.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (options.length) field.addOptions(options);
    field.addToPage(page, box);
    if (a.fontSize) field.setFontSize(a.fontSize);
  } else {
    const field = form.createTextField(name);
    if (a.multiline) field.enableMultiline();
    field.addToPage(page, box);
    if (a.fontSize) field.setFontSize(a.fontSize);
  }
  return name;
}

/** Nom proposé pour un nouveau champ : texte_1, case_2, liste_1… */
export function suggestFieldName(type: FieldAnnotation["fieldType"], taken: string[]): string {
  const prefix = { text: "texte", checkbox: "case", dropdown: "liste" }[type];
  let i = 1;
  while (taken.includes(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}
