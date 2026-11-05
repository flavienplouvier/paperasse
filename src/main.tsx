import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadLibrary, loadLocalFontsIfGranted } from "./lib/fonts";
import "./styles.css";
import { setLocale, type Locale } from "./i18n";
import { initialLanguage } from "./lib/language";

// Catalogue de la bibliothèque de polices (les fichiers ne sont chargés qu'à l'usage),
// et polices de l'ordinateur si l'accès a déjà été autorisé.
loadLibrary(import.meta.env.BASE_URL);
loadLocalFontsIfGranted();

// Langue de l'interface chargée avant le premier affichage (pas de clignotement en français).
setLocale(initialLanguage().language.code as Locale)
  .catch(() => undefined)
  .finally(() =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );

// Application installable et utilisable hors ligne (Android, ordinateur).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    // Stockage persistant : le navigateur n'efface pas de lui-même le cache (polices
    // téléchargées, application hors ligne) quand l'appareil manque de place.
    // Accordé automatiquement pour une application installée ; sans effet sinon.
    navigator.storage?.persist?.().catch(() => undefined);
  });
}
