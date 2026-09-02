import { Hono } from "hono";

import type { ArtifactKind } from "api-server-api";
import type { ShareViewerService } from "../services/share-viewer-service.js";
import { createRawHandler, RAW_ROUTE } from "./raw-handler.js";
import {
  renderDownloadInner,
  renderImageInner,
  renderTextKindInner,
} from "./renderer.js";
import { parseVersion } from "./version-query.js";

const RENDER_MAX_BYTES = 10 * 1024 * 1024;

export interface ContentAppDeps {
  viewer: ShareViewerService;
  shareBaseUrl: string;
}

export function createContentApp(deps: ContentAppDeps): Hono {
  const { viewer } = deps;
  const shareOrigin = new URL(deps.shareBaseUrl).origin;
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      c.req.path.endsWith("/raw")
        ? `sandbox; frame-ancestors ${shareOrigin}`
        : `frame-ancestors ${shareOrigin}`,
    );
  });

  app.get("/a/:slug", async (c) => {
    const slug = c.req.param("slug");
    const resolution = await viewer.resolveArtifact(slug);
    if (resolution.state !== "ok")
      return c.text("not found", resolution.state === "expired" ? 410 : 404);

    const artifact = resolution.artifact;
    const requested = parseVersion(c.req.query("v"));
    const version = requested ?? artifact.version;
    const versionArg = version === artifact.version ? undefined : version;
    const meta = await viewer.meta(artifact, versionArg);
    if (!meta) return c.text("not found", 404);

    const kind = artifact.kind as ArtifactKind;
    const rawUrl = `/a/${slug}/raw?v=${version}`;
    const downloadInner = () =>
      renderDownloadInner({
        title: artifact.title,
        fileName: artifact.fileName,
        sizeBytes: meta.sizeBytes,
        rawUrl: `${rawUrl}&download=1`,
      });
    if (kind !== "binary") {
      const blob = await viewer.content(artifact, versionArg, RENDER_MAX_BYTES);
      return c.html(
        blob
          ? renderTextKindInner(kind, blob.content.toString("utf8"), {
              title: artifact.title,
              fileName: artifact.fileName,
            })
          : downloadInner(),
      );
    }
    if (meta.contentType.startsWith("image/"))
      return c.html(renderImageInner(rawUrl, artifact.title));
    return c.html(downloadInner());
  });

  app.get(RAW_ROUTE, createRawHandler(viewer));

  app.notFound((c) => c.text("not found", 404));

  return app;
}
