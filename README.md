# Paperasse — éditeur PDF libre

Paperasse est un éditeur PDF qui fonctionne entièrement dans le navigateur : sur
ordinateur, tablette ou téléphone Android. Les fichiers restent sur l'appareil,
rien n'est envoyé sur un serveur.

**Utiliser Paperasse en ligne : https://flavienplouvier.github.io/paperasse/**

## Fonctionnalités

**Lecture**
- Affichage fidèle de tous les PDF (moteur pdf.js) : polices intégrées, les
  14 polices standard, écritures asiatiques (CMaps), JPEG 2000, JBIG2, profils couleur.
- Zoom (boutons, Ctrl+molette, pincement à deux doigts), ajustement à la largeur.
- Miniatures, recherche plein texte insensible à la casse et aux accents.
- Sélection et copie du texte.
- PDF protégés par mot de passe (avec le mot de passe).

**Modification**
- *Modifier le texte* : touchez une ligne du PDF, elle est remplacée par un texte
  modifiable, dans la police d'origine si elle est disponible.
- Le texte sélectionné se modifie directement sur la page, dans sa police, sa
  taille et sa couleur d'origine (poignée pour le déplacer).
- Lettres absentes de la police incorporée (un PDF n'en contient que les
  caractères utilisés) : elles sont cherchées dans les autres parties de la même
  police du PDF, sinon seule la lettre manquante prend la police complète
  (installée, importée ou du catalogue libre) ; le reste du texte garde la police
  d'origine.
- Documents de l'État composés en Marianne (Cerfa…) : la police Marianne est
  chargée à la demande depuis le serveur officiel
  (`fonts.forge.apps.education.fr`) pour compléter les lettres absentes. Elle
  n'est pas incluse dans Paperasse : son usage est réservé à l'administration
  (circulaire n° 6144/SG).
- Plus généralement, la police complète d'un document est chargée à la demande
  depuis une source officielle quand sa licence le permet, à la graisse exacte :
  polices libres du catalogue en Light, Medium, SemiBold, ExtraBold, Black…
  (Fontsource), DejaVu (paquet officiel). Les polices commerciales (Arial,
  Calibri, Segoe UI…) restent remplacées par leur équivalent le plus proche.
- Bibliothèque de 75 familles de polices libres (près de 250 styles), dont des
  équivalents aux mêmes dimensions des polices Office/Windows : Carlito
  (Calibri), Caladea (Cambria), Arimo (Arial/Helvetica), Tinos (Times New
  Roman), Cousine (Courier New), Gelasio (Georgia).
- Catalogue libre Google Fonts complet (≈ 2 000 familles, licences OFL et
  Apache) : recherche par nom, téléchargement à la demande puis disponible hors
  ligne. Index régénérable avec `npm run fonts:catalog`.
- Ajout de texte avec n'importe quelle police : bibliothèque, polices standard
  PDF, polices installées sur l'ordinateur (Chrome/Edge), fichiers TTF/OTF/TTC
  importés. Les polices sont intégrées au PDF : cyrillique, grec, arabe, chinois, japonais…
- Mise en forme : gras, italique, souligné.
- Dessin à main levée, surligneur, rectangles, ellipses, traits, flèches.
- Cache blanc : le texte qu'il recouvre est aussi retiré du fichier à
  l'enregistrement (il n'est plus copiable ni indexable). Les images et dessins
  sous le cache sont seulement recouverts.
- Tampons (Approuvé, Payé, Reçu, Confidentiel… ou texte libre), avec date.
- Signature au doigt, au stylet ou à la souris, ou importée depuis une photo /
  un scan (fond blanc retiré automatiquement) ; insertion d'images.
- Remplissage des formulaires PDF (texte, cases, listes, boutons radio).
- Création de formulaires : zones de texte (une ou plusieurs lignes), cases à
  cocher, listes déroulantes, enregistrées comme de vrais champs PDF.
- Reconnaissance de texte (OCR, Tesseract) : un PDF scanné devient cherchable,
  sélectionnable et modifiable ; le texte reconnu est ajouté de façon
  invisible sans changer l'aspect. Français et anglais, entièrement sur
  l'appareil ; les scans sont détectés à l'ouverture.
- Déplacement, redimensionnement, duplication, annulation/rétablissement.

**Pages**
- Rotation, suppression, duplication, réorganisation, page blanche.
- Fusion de plusieurs PDF, extraction de pages, conversion d'images en PDF.
- Compression (menu ⋮ → Compresser le PDF) : sans perte, recommandée (images à
  150 ppp) ou forte (96 ppp). Les images sont réduites d'après leur taille
  d'affichage réelle et réencodées en JPEG sur l'appareil ; une image n'est
  remplacée que si le résultat est nettement plus léger.
- Numérotation des pages, en-tête et pied de page (page, total, date, titre),
  filigrane, propriétés du document (titre, auteur, sujet, mots-clés).
- Export d'une page en image PNG.

**Numérisation (appareil photo)**
- *Scanner un document* : la feuille est détectée en direct dans l'image de la
  caméra, ses bords sont proposés et s'ajustent au doigt (loupe pendant le
  glissement), puis la page est redressée.
- Ombres et dominante de couleur retirées, fond blanchi ; rendus « Éclairci »,
  « Gris », « Noir et blanc » ou « Original ».
- Plusieurs pages, rotation, recadrage après coup ; flash (lampe) sur les
  téléphones qui le permettent, sinon appareil photo du téléphone ou import de photos.
- Le PDF (pages au format A4) s'ouvre dans l'éditeur, la date du jour déjà
  proposée dans son nom.
- Tout le traitement se fait sur l'appareil.

**Partout**
- Interface adaptée au téléphone (barre d'outils en bas, panneaux en tiroir).
- Application installable (PWA) et utilisable hors ligne.
- Sauvegarde automatique du travail en cours dans le navigateur, proposé à la
  reprise sur l'écran d'accueil (sauf PDF protégés par mot de passe).
- Enregistrement, partage (Android) et impression.
- Nom du fichier choisi à chaque enregistrement ou partage, avec une date
  facultative : format `2026-11-05` ou `05-11-2026`, au début ou à la fin du nom,
  espaces remplacés ou non par des « _ » (`Facture_EDF_2026-11-05.pdf`). Les
  réglages sont retenus d'une fois sur l'autre. Si le nom contient déjà une date
  (au début ou à la fin), elle peut être remplacée : la nouvelle reprend son
  format, sa place et son séparateur.

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

La version officielle est publiée sur https://flavienplouvier.github.io/paperasse/.

Le build utilise des chemins relatifs : il fonctionne aussi sur tout hébergement
statique (Netlify, Cloudflare Pages, serveur web…).

## Installer sur Android

Ouvrez https://flavienplouvier.github.io/paperasse/ dans Chrome, puis menu ⋮ → **Installer l'application**
(ou **Ajouter à l'écran d'accueil**). Paperasse s'ouvre alors en plein écran et
fonctionne sans connexion.

## Limites actuelles

- *Modifier le texte* retire réellement l'ancien texte du fichier à l'enregistrement
  (il n'est plus copiable ni indexable). Exceptions, où l'ancien texte est seulement
  recouvert d'un cache : PDF scanné (le texte fait partie de l'image), texte placé
  dans un sous-dessin (XObject) et polices à encodage CMap non standard.
  Ces mêmes exceptions valent pour le cache blanc : sur un scan, ne comptez pas
  sur lui pour supprimer une information de l'image.
- Sur Android, les polices de l'appareil ne sont pas accessibles aux sites web :
  importez un fichier TTF/OTF pour écrire dans une autre police que les polices standard.
- Les PDF chiffrés sont réenregistrés page par page en image (texte non
  sélectionnable), et uniquement si leurs permissions autorisent la modification.
- Les formulaires XFA (anciens formulaires dynamiques Adobe) ne sont pas remplissables.
- Numérisation : la détection automatique a besoin d'un fond qui contraste avec
  la feuille (feuille blanche sur table blanche : ajustez les coins à la main).
  Le flash n'est pilotable que là où le navigateur l'autorise (Chrome sur Android) ;
  sur iPhone, le bouton « appareil photo du téléphone » ouvre la caméra native et son flash.

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
    Scanner.tsx           numérisation (caméra, recadrage, filtres), chargé à la demande
  lib/
    pdfjs.ts              ouverture et rendu (pdf.js)
    exportPdf.ts          écriture des annotations dans le PDF (pdf-lib)
    pageOps.ts            rotation, suppression, fusion, extraction…
    forms.ts              lecture et remplissage des formulaires
    fonts.ts              registre et correspondance des polices
    fontkitCompat.ts      prise en charge des collections de polices (.ttc)
    rasterExport.ts       export des PDF chiffrés
    scan.ts               détection de la feuille, redressement, nettoyage des ombres
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
[React](https://react.dev) (MIT), [tesseract.js](https://github.com/naptha/tesseract.js)
(Apache-2.0) et ses données de langues (`@tesseract.js-data`, MIT / Apache-2.0).
Les polices de la bibliothèque sont sous
licence SIL Open Font License ou Apache 2.0 ; chaque dossier de
`public/fonts/` contient sa licence. Les polices que vous importez restent
soumises à leur propre licence, notamment pour leur intégration dans des PDF.
