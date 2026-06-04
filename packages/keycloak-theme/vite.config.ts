import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { keycloakify } from "keycloakify/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    keycloakify({
      themeName: ["platform"],
      accountThemeImplementation: "none",
    }),
  ],
});
