import type { Hono } from "hono";
import type { AuthConfig } from "api-server-api";
import {
  composeArtifactLibraryForOwner,
  createArtifactLibraryRoutes,
} from "../../../modules/artifact-library/index.js";
import { createSlackOAuthRoutes } from "../../../modules/channels/infrastructure/slack-oauth.js";
import { createTelegramOAuthRoutes } from "../../../modules/channels/infrastructure/telegram-oauth.js";
import type { ApiServerDeps, ApiVariables } from "../deps.js";
import { createOAuthRoutes } from "../../../modules/connections/index.js";
import { createBrandRoutes } from "./brand.js";
import { createPublicAgentRoutes } from "../../../modules/agents/index.js";

type App = Hono<{ Variables: ApiVariables }>;

export function mountRoutes(app: App, boot: ApiServerDeps): void {
  const { config, terms, jwksWarmup } = boot;

  app.get("/api/health", (c) => c.json({ status: "ok" }));
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
  app.route("/api/brand", createBrandRoutes(config.brand));
  app.route(
    "/api/public",
    createPublicAgentRoutes({ service: boot.publicAgentPageService }),
  );

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

  app.route(
    "/api/artifact-library",
    createArtifactLibraryRoutes({
      artifactLibraryFor: (owner, surface) =>
        composeArtifactLibraryForOwner({
          db: boot.db,
          artifacts: boot.artifacts,
          owner,
          surface,
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
