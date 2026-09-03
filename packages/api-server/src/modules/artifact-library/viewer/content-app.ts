import { Hono, type Context } from "hono";
import { match } from "ts-pattern";

import type { ArtifactKind } from "api-server-api";
import type { RenderTokenService } from "../services/render-token-service.js";
import type {
  SharedResolution,
  ShareViewerService,
} from "../services/share-viewer-service.js";
import {
  allowed,
  denied,
  isRestricted,
  PRIVATE_NO_STORE,
  type Authorized,
} from "./authorize.js";
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
  renderTokens: Pick<RenderTokenService, "redeem">;
  shareBaseUrl: string;
}

export function createContentApp(deps: ContentAppDeps): Hono {
  const { viewer, renderTokens } = deps;
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

  async function authorize(
    c: Context,
    resolution: SharedResolution,
  ): Promise<Authorized> {
    return match(resolution)
      .with({ state: "not-found" }, () => denied(c.text("not found", 404)))
      .with({ state: "expired" }, () => denied(c.text("not found", 410)))
      .with({ state: "ok" }, (r) => allowed(r.artifact))
      .with({ state: "restricted" }, async (r) => {
        c.header("Cache-Control", PRIVATE_NO_STORE);
        const token = c.req.query("t");
        const version = parseVersion(c.req.query("v")) ?? r.artifact.version;
        const valid =
          token !== undefined &&
          (await renderTokens.redeem(token, r.artifact, version));
        return valid
          ? allowed(r.artifact)
          : denied(c.text("unauthorized", 401));
      })
      .exhaustive();
  }

  app.get("/a/:slug", async (c) => {
    const slug = c.req.param("slug");
    const authorized = await authorize(c, await viewer.resolveArtifact(slug));
    if (!authorized.ok) return authorized.response;

    const artifact = authorized.artifact;
    const requested = parseVersion(c.req.query("v"));
    const version = requested ?? artifact.version;
    const versionArg = version === artifact.version ? undefined : version;
    const meta = await viewer.meta(artifact, versionArg);
    if (!meta) return c.text("not found", 404);

    const kind = artifact.kind as ArtifactKind;
    const token = c.req.query("t");
    const rawUrl =
      `/a/${slug}/raw?v=${version}` +
      (isRestricted(artifact) && token !== undefined
        ? `&t=${encodeURIComponent(token)}`
        : "");
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

  app.get(RAW_ROUTE, createRawHandler(viewer, authorize));

  app.notFound((c) => c.text("not found", 404));

  return app;
}
