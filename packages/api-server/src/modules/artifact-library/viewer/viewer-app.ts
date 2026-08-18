import { Hono } from "hono";

import type { ArtifactKind } from "api-server-api";
import type { ShareViewerService } from "../services/share-viewer-service.js";
import {
  renderDownloadInner,
  renderExpired,
  renderFolderPage,
  renderImageInner,
  renderNotFound,
  renderTextKindInner,
  renderWrapper,
} from "./renderer.js";

const RENDER_MAX_BYTES = 10 * 1024 * 1024;

export interface ShareViewerAppDeps {
  viewer: ShareViewerService;
  brandName: string;
  uiBaseUrl: string;
}

export function createShareViewerApp(deps: ShareViewerAppDeps): Hono {
  const { viewer } = deps;
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

  function parseVersion(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const v = Number.parseInt(raw, 10);
    return Number.isInteger(v) && v >= 1 ? v : undefined;
  }

  app.get("/a/:slug", async (c) => {
    const slug = c.req.param("slug");
    const resolution = await viewer.resolveArtifact(slug);
    if (resolution.state === "not-found") return c.html(renderNotFound(), 404);
    if (resolution.state === "expired")
      return c.html(
        renderExpired({
          withinGrace: resolution.withinGrace,
          expiredAt: resolution.expiredAt,
        }),
        410,
      );

    const artifact = resolution.artifact;
    const versionCount = await viewer.versionCount(artifact.id);
    const requested = parseVersion(c.req.query("v"));
    const version =
      requested !== undefined && requested <= versionCount
        ? requested
        : artifact.version;
    const versionArg = version === artifact.version ? undefined : version;
    const meta = await viewer.meta(artifact, versionArg);
    if (!meta) return c.html(renderNotFound(), 404);

    const kind = artifact.kind as ArtifactKind;
    const rawUrl = `/a/${slug}/raw?v=${version}`;
    const downloadInner = () =>
      renderDownloadInner({
        title: artifact.title,
        fileName: artifact.fileName,
        sizeBytes: meta.sizeBytes,
        rawUrl: `${rawUrl}&download=1`,
      });
    let inner: string;
    if (kind !== "binary") {
      const blob = await viewer.content(artifact, versionArg, RENDER_MAX_BYTES);
      inner = blob
        ? renderTextKindInner(kind, blob.content.toString("utf8"), {
            title: artifact.title,
            fileName: artifact.fileName,
          })
        : downloadInner();
    } else if (meta.contentType.startsWith("image/"))
      inner = renderImageInner(rawUrl, artifact.title);
    else inner = downloadInner();

    viewer.recordView(artifact);
    return c.html(
      renderWrapper({
        title: artifact.title,
        brandName: deps.brandName,
        innerHtml: inner,
        slug,
        version,
        versionCount,
        downloadName: artifact.fileName,
      }),
    );
  });

  app.get("/a/:slug/raw", async (c) => {
    const slug = c.req.param("slug");
    const resolution = await viewer.resolveArtifact(slug);
    if (resolution.state !== "ok")
      return c.text("not found", resolution.state === "expired" ? 410 : 404);

    const artifact = resolution.artifact;
    const requested = parseVersion(c.req.query("v"));
    const versionArg =
      requested === undefined || requested === artifact.version
        ? undefined
        : requested;
    const safeName = artifact.fileName.replace(/[\r\n"\\]/g, "");

    const blob = await viewer.contentStream(artifact, versionArg);
    if (!blob) return c.text("not found", 404);

    const isImage = blob.contentType.startsWith("image/");
    const forceDownload = c.req.query("download") === "1";
    const headers = new Headers({
      "Content-Type": isImage ? blob.contentType : "application/octet-stream",
      "Content-Length": String(blob.sizeBytes),
    });
    if (!isImage || forceDownload) {
      headers.set("Content-Disposition", `attachment; filename="${safeName}"`);
    }
    return new Response(blob.stream, { headers });
  });

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
