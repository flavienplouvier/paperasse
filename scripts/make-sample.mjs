// Génère public/samples/exemple.pdf : un document de démonstration avec du
// texte en plusieurs polices, un formulaire et une page tournée.
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const doc = await PDFDocument.create();
doc.setTitle("Exemple Feuillet");
doc.setAuthor("Feuillet");
const helv = await doc.embedFont(StandardFonts.Helvetica);
const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
const times = await doc.embedFont(StandardFonts.TimesRoman);
const courier = await doc.embedFont(StandardFonts.Courier);

// Page 1 : texte
const p1 = doc.addPage([595.28, 841.89]);
p1.drawText("Bienvenue dans Feuillet", { x: 56, y: 760, size: 28, font: helvBold, color: rgb(0.85, 0.23, 0.25) });
const body = [
  [helv, "Ce paragraphe est écrit en Helvetica. Essayez l'outil « Modifier le texte » :"],
  [helv, "touchez une ligne pour la remplacer par un texte modifiable."],
  [times, "Cette ligne utilise Times, une police à empattements."],
  [courier, "Et celle-ci Courier, une police à chasse fixe."],
];
body.forEach(([font, line], i) => p1.drawText(line, { x: 56, y: 700 - i * 26, size: 13, font }));
p1.drawText("Recherchez le mot « facture » avec la loupe.", { x: 56, y: 560, size: 13, font: helv });
p1.drawText("Montant de la facture : 1 250,00 €", { x: 56, y: 530, size: 13, font: helvBold });
p1.drawRectangle({ x: 56, y: 300, width: 483, height: 180, borderColor: rgb(0.8, 0.8, 0.85), borderWidth: 1 });
p1.drawText("Zone libre pour dessiner, surligner ou signer.", { x: 72, y: 450, size: 12, font: times, color: rgb(0.4, 0.4, 0.45) });

// Page 2 : formulaire
const p2 = doc.addPage([595.28, 841.89]);
p2.drawText("Formulaire d'inscription", { x: 56, y: 760, size: 22, font: helvBold });
const form = doc.getForm();
const label = (t, y) => p2.drawText(t, { x: 56, y, size: 12, font: helv });
label("Nom :", 700);
form.createTextField("nom").addToPage(p2, { x: 160, y: 692, width: 300, height: 24 });
label("E-mail :", 655);
form.createTextField("email").addToPage(p2, { x: 160, y: 647, width: 300, height: 24 });
label("Pays :", 610);
const pays = form.createDropdown("pays");
pays.addOptions(["France", "Belgique", "Suisse", "Canada"]);
pays.addToPage(p2, { x: 160, y: 602, width: 160, height: 24 });
label("J'accepte les conditions", 565);
form.createCheckBox("conditions").addToPage(p2, { x: 160 + 60, y: 563, width: 16, height: 16 });
label("Commentaire :", 520);
const comment = form.createTextField("commentaire");
comment.enableMultiline();
comment.addToPage(p2, { x: 160, y: 430, width: 300, height: 100 });

// Page 3 : page tournée
const p3 = doc.addPage([595.28, 841.89]);
p3.setRotation(degrees(90));
p3.drawText("Page tournée de 90° : les outils s'y adaptent.", { x: 56, y: 760, size: 16, font: helv });

mkdirSync("public/samples", { recursive: true });
writeFileSync("public/samples/exemple.pdf", await doc.save());
console.log("Exemple généré : public/samples/exemple.pdf");
