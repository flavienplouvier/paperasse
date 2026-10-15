# Paperasse — éditeur PDF libre

Paperasse est un éditeur PDF qui fonctionne entièrement dans le navigateur : sur
ordinateur, tablette ou téléphone Android. Les fichiers restent sur l'appareil,
rien n'est envoyé sur un serveur.

## Fonctionnalités

**Lecture**
- Affichage fidèle de tous les PDF (moteur pdf.js) : polices intégrées, les
  14 polices standard, écritures asiatiques (CMaps), JPEG 2000, JBIG2, profils couleur.
- Zoom (boutons, Ctrl+molette, pincement à deux doigts), ajustement à la largeur.
- Miniatures, recherche plein texte insensible à la casse et aux accents.
- Sélection et copie du texte.
- PDF protégés par mot de passe (avec le mot de passe).

**Modification**
- *Modifier le texte* : touchez une ligne du PDF, elle est masquée et remplacée
  par un texte modifiable, dans la police d'origine si elle est disponible.
- Le texte sélectionné se modifie directement sur la page, dans sa police, sa
  taille et sa couleur d'origine (poignée pour le déplacer).
- Bibliothèque de 75 familles de polices libres (près de 250 styles), dont des
  équivalents aux mêmes dimensions des polices Office/Windows : Carlito
  (Calibri), Caladea (Cambria), Arimo (Arial/Helvetica), Tinos (Times New
  Roman), Cousine (Courier New), Gelasio (Georgia).
- Ajout de texte avec n'importe quelle police : bibliothèque, polices standard
  PDF, polices installées sur l'ordinateur (Chrome/Edge), fichiers TTF/OTF/TTC
  importés. Les polices sont intégrées au PDF : cyrillique, grec, arabe, chinois, japonais…
- Mise en forme : gras, italique, souligné.
- Dessin à main levée, surligneur, rectangles, ellipses, traits, flèches, cache blanc.
- Tampons (Approuvé, Payé, Reçu, Confidentiel… ou texte libre), avec date.
- Signature au doigt, au stylet ou à la souris, ou importée depuis une photo /
  un scan (fond blanc retiré automatiquement) ; insertion d'images.
- Remplissage des formulaires PDF (texte, cases, listes, boutons radio).
- Déplacement, redimensionnement, duplication, annulation/rétablissement.

**Pages**
- Rotation, suppression, duplication, réorganisation, page blanche.
- Fusion de plusieurs PDF, extraction de pages, conversion d'images en PDF.
- Numérotation des pages, en-tête et pied de page (page, total, date, titre),
  filigrane, propriétés du document (titre, auteur, sujet, mots-clés).
- Export d'une page en image PNG.

**Partout**
- Interface adaptée au téléphone (barre d'outils en bas, panneaux en tiroir).
- Application installable (PWA) et utilisable hors ligne.
- Sauvegarde automatique du travail en cours dans le navigateur, proposé à la
  reprise sur l'écran d'accueil (sauf PDF protégés par mot de passe).
- Enregistrement, partage (Android) et impression.

## Démarrer

Prérequis : Node.js 22.19+ ou 24.11+.

```bash
npm install
npm run dev
```

Puis ouvrez http://localhost:5173.

| Commande            | Rôle                                      |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | serveur de développement                  |
| `npm test`          | tests unitaires (Vitest)                  |
| `npm run typecheck` | vérification TypeScript                   |
| `npm run build`     | build de production dans `dist/`          |
| `npm run preview`   | prévisualise le build                     |

`npm run dev` et `npm run build` copient d'abord dans `public/pdfjs/` les
ressources de pdf.js nécessaires au rendu des polices, et dans `public/fonts/`
la bibliothèque de polices (paquets `@expo-google-fonts/*`, 4 styles par
famille, environ 50 Mo chargés uniquement à l'usage). Pour ajouter une famille :
`npm install -D @expo-google-fonts/<famille>` puis `npm run assets`.

## Polices non libres (Calibri, Arial, Helvetica Neue…)

Les polices commerciales ne peuvent pas être redistribuées avec l'application.
Pour les utiliser quand même :

1. **Polices de l'ordinateur** (Chrome ou Edge sur ordinateur) : dans le
   sélecteur de police, « Utiliser mes polices installées ». Toutes les polices
   de Windows, d'Office ou d'Adobe Fonts présentes sur le poste deviennent
   disponibles, et « Modifier le texte » les retrouve automatiquement.
2. **Fichier de police** (tous appareils, Android compris) : « Importer
   TTF/OTF… » avec un fichier dont vous détenez la licence.
3. **À défaut**, Paperasse choisit l'équivalent libre le plus proche, aux mêmes
   dimensions pour les polices Office courantes.

L'intégration d'une police dans un PDF dépend de sa licence ; la plupart des
polices Windows et Office l'autorisent pour l'impression et l'affichage.

## Publier sur GitHub Pages

1. Créez un dépôt sur GitHub et poussez ce projet sur la branche `main`.
2. Dans **Settings → Pages → Build and deployment**, choisissez **GitHub Actions**.
3. Le workflow `.github/workflows/deploy.yml` publie l'application à chaque
   push sur `main`, à l'adresse `https://<utilisateur>.github.io/<dépôt>/`.

Le build utilise des chemins relatifs : il fonctionne aussi sur tout hébergement
statique (Netlify, Cloudflare Pages, serveur web…).

## Installer sur Android

Ouvrez l'adresse publiée dans Chrome, puis menu ⋮ → **Installer l'application**
(ou **Ajouter à l'écran d'accueil**). Paperasse s'ouvre alors en plein écran et
fonctionne sans connexion.

## Limites actuelles

- *Modifier le texte* remplace une ligne par un nouveau texte posé par-dessus ;
  le texte d'origine est masqué, pas supprimé du fichier.
- Sur Android, les polices de l'appareil ne sont pas accessibles aux sites web :
  importez un fichier TTF/OTF pour écrire dans une autre police que les polices standard.
- Les PDF chiffrés sont réenregistrés page par page en image (texte non
  sélectionnable), et uniquement si leurs permissions autorisent la modification.
- Les formulaires XFA (anciens formulaires dynamiques Adobe) ne sont pas remplissables.

## Architecture

```
src/
  App.tsx                 état du document, historique, mise en page
  components/
    PageView.tsx          rendu d'une page (canvas + texte + annotations SVG)
    Thumbnails.tsx        miniatures et opérations sur les pages
    PropertiesPanel.tsx   réglages de l'outil / de l'élément sélectionné
    FontPicker.tsx        choix de police (standard, installées, importées)
    SearchPanel.tsx, FormsPanel.tsx, SignaturePad.tsx
  lib/
    pdfjs.ts              ouverture et rendu (pdf.js)
    exportPdf.ts          écriture des annotations dans le PDF (pdf-lib)
    pageOps.ts            rotation, suppression, fusion, extraction…
    forms.ts              lecture et remplissage des formulaires
    fonts.ts              registre et correspondance des polices
    fontkitCompat.ts      prise en charge des collections de polices (.ttc)
    rasterExport.ts       export des PDF chiffrés
```

Les annotations sont gardées dans l'espace de coordonnées PDF et rattachées à
un identifiant de page stable : elles suivent les rotations et réorganisations.
Elles sont dessinées dans le contenu des pages à l'enregistrement, donc visibles
dans tous les lecteurs PDF.

## Licence

Code de Paperasse : [MIT](LICENSE).

Bibliothèques principales : [pdf.js](https://github.com/mozilla/pdf.js)
(Apache-2.0), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT),
[@pdf-lib/fontkit](https://github.com/Hopding/fontkit) (MIT),
[React](https://react.dev) (MIT). Les polices de la bibliothèque sont sous
licence SIL Open Font License ou Apache 2.0 ; chaque dossier de
`public/fonts/` contient sa licence. Les polices que vous importez restent
soumises à leur propre licence, notamment pour leur intégration dans des PDF.
