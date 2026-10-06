import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { ApiVariables } from "../deps.js";

const STREAM_PAGE_PREFIX = /^\/api\/public\/browser-stream\/[^/]+/;

export const BROWSER_STREAM_WEB_DIR =
  process.env.PLATFORM_BROWSER_STREAM_WEB_DIR ?? "selkies-web";

export function mountBrowserStreamPage(
  app: Hono<{ Variables: ApiVariables }>,
  root: string = BROWSER_STREAM_WEB_DIR,
): void {
  app.use("/api/public/browser-stream/:id/*", async (c, next) => {
    await next();
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
  });
  app.get(
    "/api/public/browser-stream/:id/*",
    serveStatic({
      root,
      rewriteRequestPath: (path) =>
        path.replace(STREAM_PAGE_PREFIX, "") || "/index.html",
    }),
  );
}
