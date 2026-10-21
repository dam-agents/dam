import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { match } from "ts-pattern";

import { artifactApiRequestInputSchema } from "agent-runtime-api";
import type { ArtifactKind } from "api-server-api";
import type {
  ShareSession,
  ShareSessionCookie,
} from "../domain/share-session.js";
import { viewerPromptInputSchema } from "../domain/viewer-bridge.js";
import type {
  ShareBridgeService,
  ViewerCallKind,
} from "../services/share-bridge-service.js";
import type { ArtifactRow } from "../infrastructure/artifact-library-repository.js";
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

export interface ShareViewerAppDeps {
  viewer: ShareViewerService;
  auth: Pick<ShareAuthService, "getSession">;
  sessionCookie: ShareSessionCookie;
  renderTokens: Pick<RenderTokenService, "mint">;
  brandName: string;
  uiBaseUrl: string;
  contentBaseUrl: string;
  shareBaseUrl: string;
  bridge: ShareBridgeService;
}

type Surface = "page" | "raw";

const BRIDGE_BODY_MAX_BYTES = 2 * 1024 * 1024;
const NOT_ALLOWED = { ok: false, reason: "not-allowed" } as const;

export function createShareViewerApp(deps: ShareViewerAppDeps): Hono {
  const { viewer, auth, renderTokens } = deps;
  const contentBase = deps.contentBaseUrl.replace(/\/+$/, "");
  const shareOrigin = new URL(deps.shareBaseUrl).origin;
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
          const session = await readShareSession(c, auth, deps.sessionCookie);
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
                      next: currentPath(c),
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

  async function bridgeCaller(
    c: Context,
    kind: ViewerCallKind,
  ): Promise<
    | { ok: true; artifact: ArtifactRow; session: ShareSession }
    | { ok: false; response: Response }
  > {
    c.header("Cache-Control", PRIVATE_NO_STORE);
    if (c.req.header("origin") !== shareOrigin)
      return { ok: false, response: c.json(NOT_ALLOWED, 403) };
    const resolution = await viewer.resolveArtifact(c.req.param("slug") ?? "");
    if (resolution.state !== "restricted")
      return { ok: false, response: c.json(NOT_ALLOWED, 404) };
    const session = await readShareSession(c, auth, deps.sessionCookie);
    if (!session)
      return { ok: false, response: c.json(NOT_ALLOWED, 401) };
    if ((await viewer.canView(resolution.artifact, session)) === "deny") {
      deps.bridge.refuse(resolution.artifact, session, kind, "not-a-viewer");
      return { ok: false, response: c.json(NOT_ALLOWED, 403) };
    }
    return { ok: true, artifact: resolution.artifact, session };
  }

  async function bridgeBody(c: Context): Promise<unknown> {
    return c.req.json().catch(() => null);
  }

  const bridgeBodyLimit = bodyLimit({
    maxSize: BRIDGE_BODY_MAX_BYTES,
    onError: (c) => c.json({ ok: false, reason: "invalid-request" }, 413),
  });

  app.post("/a/:slug/request", bridgeBodyLimit, async (c) => {
    const caller = await bridgeCaller(c, "request");
    if (!caller.ok) return caller.response;
    const input = artifactApiRequestInputSchema.safeParse(await bridgeBody(c));
    if (!input.success)
      return c.json({ ok: false, reason: "invalid-request" }, 400);
    return c.json(
      await deps.bridge.request(caller.artifact, caller.session, input.data),
    );
  });

  app.post("/a/:slug/prompt", bridgeBodyLimit, async (c) => {
    const caller = await bridgeCaller(c, "prompt");
    if (!caller.ok) return caller.response;
    const input = viewerPromptInputSchema.safeParse(await bridgeBody(c));
    if (!input.success)
      return c.json({ ok: false, reason: "invalid-request" }, 400);
    return c.json(
      await deps.bridge.prompt(
        caller.artifact,
        caller.session,
        input.data.prompt,
      ),
    );
  });

  app.get("/a/:slug", async (c) => {
    const slug = c.req.param("slug");
    const authorized = await authorizePage(
      c,
      await viewer.resolveArtifact(slug),
    );
    if (!authorized.ok) return authorized.response;

    const artifact = authorized.artifact;
    const version = artifact.version;

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
        downloadName: artifact.fileName,
        relay: artifact.interactive && isRestricted(artifact),
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
