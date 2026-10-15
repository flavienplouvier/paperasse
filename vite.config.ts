import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `base: "./"` permet de publier le build tel quel sur GitHub Pages
// (https://<utilisateur>.github.io/<dépôt>/) ou dans n'importe quel sous-dossier.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
  },
});
