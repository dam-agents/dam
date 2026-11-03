import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { SAMPLE_TESTIMONIALS } from "./src/dev-preview/sample-testimonials.js";

/* UNIT_BOUNDARY_DESCRIPTION: The preview's stand-in for the api-server's public testimonials endpoint:
 * the scenarios point PLATFORM_API_URL at /preview-api (sample testimonials),
 * /preview-api/empty (none) or /preview-api/broken (a failed call). */
function previewApi(): Plugin {
  return {
    name: "preview-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/preview-api")) return next();
        if (url.startsWith("/preview-api/broken")) {
          res.statusCode = 503;
          res.end();
          return;
        }
        const testimonials = url.startsWith("/preview-api/empty")
          ? []
          : SAMPLE_TESTIMONIALS.map((t) => ({ ...t, photoUrl: null }));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ testimonials }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), previewApi()],
  root: ".",
  server: { port: 5181 },
  build: { outDir: "dist/preview" },
});
