import { currentLocale, msg, t } from "../i18n";

/** Tampons prêts à l'emploi : libellé et couleur. */
export const STAMPS: { label: string; color: string }[] = [
  { label: msg("Approuvé"), color: "#1f8a4c" },
  { label: msg("Payé"), color: "#1f8a4c" },
  { label: msg("Reçu"), color: "#1d5fbf" },
  { label: msg("Vu"), color: "#1d5fbf" },
  { label: msg("Brouillon"), color: "#6b7280" },
  { label: msg("Copie"), color: "#6b7280" },
  { label: msg("Confidentiel"), color: "#c62828" },
  { label: msg("Urgent"), color: "#c62828" },
  { label: msg("Refusé"), color: "#c62828" },
  { label: msg("Annulé"), color: "#c62828" },
];

export function todayLabel(date = new Date()): string {
  return date.toLocaleDateString(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Dessine un tampon (cadre arrondi, libellé en capitales, date facultative)
 * en PNG haute résolution, fond transparent, prêt à être posé sur une page.
 */
export function renderStamp(label: string, color: string, withDate: boolean): string {
  const scale = 3;
  const main = 30 * scale;
  const small = 14 * scale;
  const pad = 14 * scale;
  const border = 3 * scale;
  const text = label.trim().toLocaleUpperCase(currentLocale()) || t("TAMPON");
  const date = withDate ? todayLabel() : "";

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `800 ${main}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  const mainWidth = measure.measureText(text).width;
  measure.font = `600 ${small}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  const dateWidth = date ? measure.measureText(date).width : 0;

  const width = Math.ceil(Math.max(mainWidth, dateWidth) + pad * 2 + border * 2);
  const height = Math.ceil(main + (date ? small * 1.4 : 0) + pad * 1.6 + border * 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = border;
  const r = 10 * scale;
  ctx.beginPath();
  ctx.roundRect(border / 2, border / 2, width - border, height - border, r);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${main}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  const mainBaseline = border + pad * 0.8 + main * 0.82;
  ctx.fillText(text, width / 2, mainBaseline);
  if (date) {
    ctx.font = `600 ${small}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.fillText(date, width / 2, mainBaseline + small * 1.35);
  }
  return canvas.toDataURL("image/png");
}
