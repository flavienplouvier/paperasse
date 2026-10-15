import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadLibrary, loadLocalFontsIfGranted } from "./lib/fonts";
import "./styles.css";

// Catalogue de la bibliothèque de polices (les fichiers ne sont chargés qu'à l'usage),
// et polices de l'ordinateur si l'accès a déjà été autorisé.
loadLibrary(import.meta.env.BASE_URL);
loadLocalFontsIfGranted();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Application installable et utilisable hors ligne (Android, ordinateur).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
