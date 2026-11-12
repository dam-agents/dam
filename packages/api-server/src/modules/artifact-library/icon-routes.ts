import { Hono } from "hono";

import { artifactIconSvg } from "./domain/artifact-icon.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The favicon of an artifact the app opens alone in
 * a browser tab, at `/artifacts/<id>/view`. The browser fetches a favicon
 * without the app's bearer token, so the route is public; it draws the icon
 * from the stored value alone, an emoji or a free Font Awesome icon name, and
 * so reveals nothing about any artifact.
 */
export function createArtifactIconRoutes() {
  const routes = new Hono();
  routes.get("/", (c) => {
    const svg = artifactIconSvg(c.req.query("icon") ?? "");
    if (svg === null) return c.text("not found", 404);
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    return c.body(svg);
  });
  return routes;
}
