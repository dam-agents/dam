import { Hono, type Context } from "hono";
import { match } from "ts-pattern";

import type { ArtifactKind } from "api-server-api";
import type { RenderTokenService } from "../services/render-token-service.js";
import type { ShareAuthService } from "../services/share-auth-service.js";
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
  renderExpired,
  renderFolderPage,
  renderNoAccess,
  renderNotFound,
  renderWrapper,
} from "./renderer.js";
import { loginPath, readShareSession } from "./share-auth-routes.js";
import { parseVersion } from "./version-query.js";

export interface ShareViewerAppDeps {
  viewer: ShareViewerService;
  auth: Pick<ShareAuthService, "getSession">;
  renderTokens: Pick<RenderTokenService, "mint">;
  brandName: string;
  uiBaseUrl: string;
  contentBaseUrl: string;
}

type Surface = "page" | "raw";

export function createShareViewerApp(deps: ShareViewerAppDeps): Hono {
  const { viewer, auth, renderTokens } = deps;
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

  function currentPath(c: Context): string {
    const url = new URL(c.req.url);
    return `${url.pathname}${url.search}`;
  }

  function authorize(surface: Surface) {
    return async (
      c: Context,
      resolution: SharedResolution,
    ): Promise<Authorized> =>
      match(resolution)
        .with({ state: "not-found" }, () =>
          denied(
            surface === "page"
              ? c.html(renderNotFound(), 404)
              : c.text("not found", 404),
          ),
        )
        .with({ state: "expired" }, (r) =>
          denied(
            surface === "page"
              ? c.html(renderExpired({ withinGrace: r.withinGrace }), 410)
              : c.text("not found", 410),
          ),
        )
        .with({ state: "ok" }, (r) => allowed(r.artifact))
        .with({ state: "restricted" }, async (r) => {
          c.header("Cache-Control", PRIVATE_NO_STORE);
          const session = await readShareSession(c, auth);
          if (!session) {
            return denied(
              surface === "page"
                ? c.redirect(loginPath(currentPath(c)), 302)
                : c.text("unauthorized", 401),
            );
          }
          if ((await viewer.canView(r.artifact, session)) === "deny") {
            return denied(
              surface === "page"
                ? c.html(
                    renderNoAccess({
                      email: session.email,
                      brandName: deps.brandName,
                      logoutUrl: `/auth/logout?next=${encodeURIComponent(currentPath(c))}`,
                    }),
                    403,
                  )
                : c.text("forbidden", 403),
            );
          }
          return allowed(r.artifact);
        })
        .exhaustive();
  }

  const authorizePage = authorize("page");

  app.get("/a/:slug", async (c) => {
    const slug = c.req.param("slug");
    const authorized = await authorizePage(
      c,
      await viewer.resolveArtifact(slug),
    );
    if (!authorized.ok) return authorized.response;

    const artifact = authorized.artifact;
    const versionCount = await viewer.versionCount(artifact.id);
    const requested = parseVersion(c.req.query("v"));
    const version =
      requested !== undefined && requested <= versionCount
        ? requested
        : artifact.version;

    const contentUrl = new URL(`${contentBase}/a/${encodeURIComponent(slug)}`);
    contentUrl.searchParams.set("v", String(version));
    if (isRestricted(artifact)) {
      contentUrl.searchParams.set(
        "t",
        await renderTokens.mint(artifact.id, version),
      );
    }

    viewer.recordView(artifact);
    return c.html(
      renderWrapper({
        title: artifact.title,
        brandName: deps.brandName,
        contentUrl: contentUrl.href,
        slug,
        version,
        versionCount,
        downloadName: artifact.fileName,
      }),
    );
  });

  app.get(RAW_ROUTE, createRawHandler(viewer, authorize("raw")));

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
