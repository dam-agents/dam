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
      environmentVariables: [
        { name: "PLATFORM_ALLOW_PASSWORD", default: "true" },
        { name: "PLATFORM_REQUEST_ACCESS_URL", default: "" },
        { name: "PLATFORM_SHARE_CLIENT_ID", default: "platform-share" },
      ],
    }),
  ],
});
