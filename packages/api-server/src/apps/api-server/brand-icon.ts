import sharp from "sharp";
import { createHash } from "node:crypto";
import type { Hono, Env } from "hono";
import { DEFAULT_BRAND_ICON_SVG } from "./default-brand-icon.js";

/**
 * Brand icon serving — single SVG source of truth, rasterized on demand.
 *
 *   - `BRAND_ICON_SVG` env var (set by Helm when `brand.icon` is overridden)
 *     is the override. Empty / unset → bundled default.
 *   - `/api/brand/icon.svg`        → raw SVG (image/svg+xml)
 *   - `/api/brand/icon-{size}.png` → square PNG raster at `{size}` px,
 *     produced by sharp. Allowed sizes whitelisted to keep the cache
 *     bounded; the manifest + html links only need 180/192/512.
 *
 * Rasters are cached in-memory keyed by (sha256 of SVG, size). Cache is
 * effectively bounded — at most 3 entries per active SVG. A new override
 * (via `helm upgrade` + pod restart) gets a fresh hash and a fresh cache;
 * old entries vanish with the pod. Etags and immutable cache headers let
 * the browser skip the rasterization round-trip entirely on repeat loads.
 */

const ALLOWED_SIZES = new Set([180, 192, 512]);

interface IconCache {
  hash: string;
  rasters: Map<number, Buffer>;
}

export function mountBrandIconRoutes<E extends Env>(
  app: Hono<E>,
  getEnv?: () => string | undefined,
): void {
  // Resolved once per route call so test overrides (env mutated mid-test)
  // pick up the new value without re-mounting the routes.
  const resolveSvg = (): { svg: string; hash: string } => {
    const svg =
      (getEnv?.() ?? process.env.BRAND_ICON_SVG)?.trim() ||
      DEFAULT_BRAND_ICON_SVG;
    const hash = createHash("sha256").update(svg).digest("hex").slice(0, 16);
    return { svg, hash };
  };

  let cache: IconCache | null = null;

  app.get("/api/brand/icon.svg", (c) => {
    const { svg, hash } = resolveSvg();
    if (c.req.header("if-none-match") === `"${hash}"`) {
      return c.body(null, 304);
    }
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300");
    c.header("ETag", `"${hash}"`);
    return c.body(svg);
  });

  app.get("/api/brand/:file{icon-\\d+\\.png$}", async (c) => {
    const file = c.req.param("file");
    const size = Number(file.replace("icon-", "").replace(".png", ""));
    if (!ALLOWED_SIZES.has(size)) {
      return c.json(
        { error: `size must be one of ${[...ALLOWED_SIZES].join(", ")}` },
        400,
      );
    }
    const { svg, hash } = resolveSvg();
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
}
