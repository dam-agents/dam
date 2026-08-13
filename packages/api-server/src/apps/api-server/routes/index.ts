import type { Hono } from "hono";
import type { AuthConfig, UserIdentity } from "api-server-api";
import {
  composeArtifactLibraryForOwner,
  createArtifactLibraryRoutes,
} from "../../../modules/artifact-library/index.js";
import { createSlackOAuthRoutes } from "../../../modules/channels/infrastructure/slack-oauth.js";
import { createTelegramOAuthRoutes } from "../../../modules/channels/infrastructure/telegram-oauth.js";
import type { ApiServerDeps } from "../deps.js";
import { createOAuthRoutes } from "../../../modules/connections/index.js";
import { createBrandRoutes } from "./brand.js";

type App = Hono<{ Variables: { user: UserIdentity; roles: string[] } }>;

/** Plain-HTTP odds and ends: the public bootstrap endpoints (health,
 *  readiness, version, auth config, brand, terms), OAuth callback routes,
 *  usage routes, and the artifact-library binary paths. Everything here
 *  mounts BEHIND the admission chain in app.ts — an endpoint is public if
 *  and only if it is on the middleware's PUBLIC_PATHS allowlist, so adding
 *  a public route means adding it there too (missing = 401, fail-closed). */
export function mountRoutes(app: App, boot: ApiServerDeps): void {
  const { config, terms, jwksWarmup } = boot;

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  // Readiness (not liveness): 503 until the Keycloak JWKS has been fetched
  // once, so a rolling update keeps the old pod serving while this pod's
  // egress path converges. Latched — never flaps mid-life (see jwks-warmup.ts).
  app.get("/api/ready", (c) =>
    jwksWarmup.ready()
      ? c.json({ status: "ok" })
      : c.json({ status: "starting", waitingFor: "jwks" }, 503),
  );
  app.get("/api/version", (c) =>
    c.json({
      serverVersion: config.serverVersion,
      ...(config.minClientCliVersion !== undefined && {
        minClientVersion: config.minClientCliVersion,
      }),
      appVersion: config.appVersion,
    }),
  );
  app.get("/api/auth/config", (c) =>
    c.json({
      issuer: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
      clientId: config.keycloakClientId,
      cliClientId: config.keycloakCliClientId,
      inspectorRole: config.keycloakInspectorRole ?? "",
    } satisfies AuthConfig),
  );
  app.get("/api/terms", (c) => c.json(terms.document()));
  // Everything brand — document, PWA manifest, icons. Public (UI bootstrap).
  app.route("/api/brand", createBrandRoutes(config.brand));

  app.route(
    "/api/oauth",
    createOAuthRoutes({
      db: boot.db,
      secretStore: boot.secretStores.default(),
      engine: boot.connectionsBoot.oauthEngine,
      templates: boot.connectionsBoot.templates,
      runtimeMutator: boot.runtimeMutator,
      uiBaseUrl: config.uiBaseUrl,
    }),
  );

  boot.mountUsageRoutes(app);

  // Artifact-library binary paths — non-tRPC (upload carries raw bytes in,
  // download streams bytes or returns a presigned direct link).
  app.route(
    "/api/artifact-library",
    createArtifactLibraryRoutes({
      artifactLibraryFor: (owner) =>
        composeArtifactLibraryForOwner({
          db: boot.db,
          artifacts: boot.artifacts,
          owner,
          shareBaseUrl: config.shareBaseUrl,
        }).artifactLibrary,
      artifacts: boot.artifacts,
    }),
  );

  if ((config.slackBotToken && config.slackAppToken) || config.e2eEnabled) {
    app.route(
      "/api/slack",
      createSlackOAuthRoutes({
        pendingFlows: boot.pendingSlackOAuthFlows,
        bindFlows: boot.slackBindFlows,
        identityLinks: boot.identityLinkService,
        brandShort: config.brand.short,
        uiBaseUrl: config.uiBaseUrl,
        oauthConfig: {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: boot.slackOauthCallbackUrl,
        },
      }),
    );
  }

  if (config.telegramBotToken && boot.telegramBindFlows) {
    app.route(
      "/api/telegram",
      createTelegramOAuthRoutes({
        pendingFlows: boot.pendingTelegramOAuthFlows,
        bindFlows: boot.telegramBindFlows,
        oauthConfig: {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: `${config.uiBaseUrl}/api/telegram/oauth/callback`,
        },
        uiBaseUrl: config.uiBaseUrl,
      }),
    );
  }
}
