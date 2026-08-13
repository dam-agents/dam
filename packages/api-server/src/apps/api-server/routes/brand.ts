import sharp from "sharp";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Brand } from "api-server-api";
import {
  DEFAULT_BRAND_ICON_RASTER_SVG,
  DEFAULT_BRAND_ICON_SVG,
} from "./default-brand-icon.js";

const ALLOWED_SIZES = new Set([180, 192, 512]);

interface IconCache {
  hash: string;
  rasters: Map<number, Buffer>;
}

export function createBrandRoutes(
  brand: Brand,
  getEnv?: () => string | undefined,
) {
  const routes = new Hono();

  routes.get("/", (c) => c.json(brand satisfies Brand));

  routes.get("/manifest.webmanifest", (c) => {
    c.header("Content-Type", "application/manifest+json");
    return c.body(
      JSON.stringify({
        name: brand.name,
        short_name: brand.name,
        description: "AI agent platform",
        theme_color: brand.theme.light.accent,
        background_color: "#fafaf9",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/api/brand/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/api/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/api/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      }),
    );
  });

  const resolveSvg = (
    fallback: string = DEFAULT_BRAND_ICON_SVG,
  ): { svg: string; hash: string } => {
    const svg = (getEnv?.() ?? process.env.BRAND_ICON_SVG)?.trim() || fallback;
    const hash = createHash("sha256").update(svg).digest("hex").slice(0, 16);
    return { svg, hash };
  };

  let cache: IconCache | null = null;

  routes.get("/icon.svg", (c) => {
    const { svg, hash } = resolveSvg();
    if (c.req.header("if-none-match") === `"${hash}"`) {
      return c.body(null, 304);
    }
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300");
    c.header("ETag", `"${hash}"`);
    return c.body(svg);
  });

  routes.get("/:file{icon-\\d+\\.png$}", async (c) => {
    const file = c.req.param("file");
    const size = Number(file.replace("icon-", "").replace(".png", ""));
    if (!ALLOWED_SIZES.has(size)) {
      return c.json(
        { error: `size must be one of ${[...ALLOWED_SIZES].join(", ")}` },
        400,
      );
    }
    const { svg, hash } = resolveSvg(DEFAULT_BRAND_ICON_RASTER_SVG);
    if (c.req.header("if-none-match") === `"${hash}-${size}"`) {
      return c.body(null, 304);
    }
    if (!cache || cache.hash !== hash) cache = { hash, rasters: new Map() };
    let png = cache.rasters.get(size);
    if (!png) {
      png = await sharp(Buffer.from(svg))
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      cache.rasters.set(size, png);
    }
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=300");
    c.header("ETag", `"${hash}-${size}"`);
    return c.body(new Uint8Array(png));
  });

  return routes;
}
