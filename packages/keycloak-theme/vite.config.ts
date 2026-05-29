import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { keycloakify } from "keycloakify/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_NAME": JSON.stringify(
      process.env.APP_NAME ?? "Dam",
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    keycloakify({
      themeName: ["platform"],
      accountThemeImplementation: "none",
    }),
  ],
});
