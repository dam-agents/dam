/**
 * The public share host — a self-contained Hono app the api-server serves
 * ONLY when the request's Host matches the configured share host. It carries
 * no user authentication, no tRPC, and no platform routes: the unguessable
 * slug is the capability (expiry bounds it), and everything it renders is
 * platform chrome around sandboxed user content (see renderer.ts).
 *
 * Kept dependency-thin on purpose so it can move into its own deployment
 * later without touching the module internals (viewer service + renderer).
 */
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

/** Text-kind render ceiling — the wrapper embeds the source into the page,
 *  so this bounds how much of a blob a single public view can pull into the
 *  api-server heap. Bigger artifacts fall back to the download card (which
 *  redirects to the store). Mirrors the in-app preview cap. */
const RENDER_MAX_BYTES = 10 * 1024 * 1024;

export interface ShareViewerAppDeps {
  viewer: ShareViewerService;
  brandName: string;
  /** App origin — everything that isn't a share route redirects here. */
  uiBaseUrl: string;
}

export function createShareViewerApp(deps: ShareViewerAppDeps): Hono {
  const { viewer } = deps;
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    // Ported from slop's serve headers. No default-src CSP on purpose: a
    // srcdoc iframe inherits the parent CSP, and a restrictive one would
    // break user content — the sandbox attribute + dedicated origin are the
    // isolation, CSP just pins framing and form targets. The one exception
    // is /raw: SVG is the only image type that can carry script, and a
    // direct top-level navigation to an inline-served SVG would run it on
    // the share origin OUTSIDE the iframe sandbox — the `sandbox` directive
    // (no allow-*) blocks that while leaving <img> embedding untouched.
    // Never add it to the page routes: it would sandbox the wrapper and its
    // srcdoc iframe inherits it, breaking user content.
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
    // Branch on metadata only — binary blobs are never buffered here (images
    // load via <img src=raw>, downloads via the raw redirect), and text
    // renders are size-capped.
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

    viewer.recordView(artifact.id);
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

    // Stream store → response with constant memory; the store itself is
    // never exposed to the public side (no presigned links on this origin),
    // so bytes relay through the api-server but never accumulate in it.
    const blob = await viewer.contentStream(artifact, versionArg);
    if (!blob) return c.text("not found", 404);

    // Inline rendering of raw bytes on this origin is allowed only for
    // images (passive content). Everything else downloads: raw text/html
    // served inline would execute on the share origin *outside* the
    // sandboxed iframe.
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

  // Anything else on the share host bounces to the app origin (slop's
  // viewer-worker behavior) — the share host serves shared content only.
  app.notFound((c) => c.redirect(deps.uiBaseUrl, 302));

  return app;
}
