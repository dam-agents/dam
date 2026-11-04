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
      keycloakifyBuildDirPath: "dist/jar",
      accountThemeImplementation: "none",
      environmentVariables: [
        { name: "PLATFORM_ALLOW_PASSWORD", default: "true" },
        { name: "PLATFORM_SHARE_CLIENT_ID", default: "platform-share" },
        { name: "PLATFORM_BRAND_NAME_MEANINGS", default: "[]" },
        {
          name: "PLATFORM_DOCS_URL",
          default: "https://pages.github.ibm.com/dam-agents/docs/",
        },
      ],
    }),
  ],
  build: {
    outDir: "dist/js",
  },
});
