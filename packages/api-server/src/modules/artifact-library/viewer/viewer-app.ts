import { Hono } from "hono";

import type { ArtifactKind } from "api-server-api";
import type { ShareViewerService } from "../services/share-viewer-service.js";
import { createRawHandler, RAW_ROUTE } from "./raw-handler.js";
import {
  renderExpired,
  renderFolderPage,
  renderNotFound,
  renderWrapper,
} from "./renderer.js";
import { parseVersion } from "./version-query.js";

export interface ShareViewerAppDeps {
  viewer: ShareViewerService;
  brandName: string;
  uiBaseUrl: string;
  contentBaseUrl: string;
}

export function createShareViewerApp(deps: ShareViewerAppDeps): Hono {
  const { viewer } = deps;
  const contentBase = deps.contentBaseUrl.replace(/\/+$/, "");
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      c.req.path.endsWith("/raw")
        ? "sandbox; frame-ancestors 'self'; form-action 'self'"
        : "frame-ancestors 'self'; form-action 'self'",
    );
  });

  app.get("/a/:slug", async (c) => {
    const slug = c.req.param("slug");
    const resolution = await viewer.resolveArtifact(slug);
    if (resolution.state === "not-found") return c.html(renderNotFound(), 404);
    if (resolution.state === "expired")
      return c.html(
        renderExpired({ withinGrace: resolution.withinGrace }),
        410,
      );

    const artifact = resolution.artifact;
    const versionCount = await viewer.versionCount(artifact.id);
    const requested = parseVersion(c.req.query("v"));
    const version =
      requested !== undefined && requested <= versionCount
        ? requested
        : artifact.version;

    viewer.recordView(artifact);
    return c.html(
      renderWrapper({
        title: artifact.title,
        brandName: deps.brandName,
        contentUrl: `${contentBase}/a/${encodeURIComponent(slug)}?v=${version}`,
        slug,
        version,
        versionCount,
        downloadName: artifact.fileName,
      }),
    );
  });

  app.get(RAW_ROUTE, createRawHandler(viewer));

  app.get("/f/:slug", async (c) => {
    const slug = c.req.param("slug");
    const resolution = await viewer.resolveFolder(slug);
    if (resolution.state === "not-found") return c.html(renderNotFound(), 404);

    return c.html(
      renderFolderPage({
        name: resolution.folder.name,
        brandName: deps.brandName,
        artifacts: resolution.artifacts.map((a) => ({
          slug: a.slug,
          title: a.title,
          kind: a.kind as ArtifactKind,
          version: a.version,
          viewCount: a.viewCount,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
        })),
      }),
    );
  });

  app.notFound((c) => c.redirect(deps.uiBaseUrl, 302));

  return app;
}
