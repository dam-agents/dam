import { request as httpRequest } from "node:http";
import { Readable, Transform } from "node:stream";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import type {
  ApiContext,
  AuthConfig,
  Brand,
  E2eService,
  TermsService,
  UserIdentity,
} from "api-server-api";
import type { CoreV1Api } from "@kubernetes/client-node";
import type { Db } from "db";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import {
  createK8sClient,
  podBaseUrl,
} from "../../modules/agents/infrastructure/k8s.js";
import {
  ANN_PENDING_IMPORT,
  ANN_IMPORT_ERROR,
} from "../../modules/agents/infrastructure/labels.js";
import { pollUntilReady } from "../../modules/agents/infrastructure/poll-until-ready.js";
import {
  composeAgentsModule,
  createAgentsRepository,
  createKeycloakUserDirectory,
  type ContributionsSettledPort,
} from "../../modules/agents/index.js";
import { composeTemplatesModule } from "../../modules/templates/index.js";
import {
  composeSchedulesForOwner,
  type SchedulesBoot,
} from "../../modules/schedules/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import { composeFilesModule } from "../../modules/files/files-service.js";
import { createSlackOAuthRoutes } from "../../modules/channels/infrastructure/slack-oauth.js";
import { createTelegramOAuthRoutes } from "../../modules/channels/infrastructure/telegram-oauth.js";
import type { TelegramOAuthPending } from "../../modules/channels/infrastructure/telegram.js";
import {
  isThreadAuthorized,
  authorizeThread,
  revokeThread,
  listAuthorizedThreads,
  getAuthorizedBy,
} from "../../modules/channels/infrastructure/telegram-threads-repository.js";
import { createAcpRelay } from "./acp-relay.js";
import { createTerminalRelay } from "./terminal-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { mountBrandIconRoutes } from "./brand-icon.js";
import type { Config } from "../../config.js";
import { createAuth, ForbiddenError, clientIp } from "./auth.js";
import { securityLog } from "../../core/security-log.js";
import { createTermsGate } from "./terms-gate.js";
import type { IsAcceptedPort } from "../../modules/terms/compose.js";
import { createK8sSecretsPort } from "./../../modules/secrets/infrastructure/k8s-secrets-port.js";
import { createSecretsService } from "./../../modules/secrets/services/secrets-service.js";
import {
  composeConnectionsAtBoot,
  composeConnectionsForOwner,
} from "./../../modules/connections/compose.js";
import { createAgentGrantsPort } from "./../../modules/agents/infrastructure/agent-grants-port.js";
import type { SecretStoreRegistry } from "./../../modules/secret-store/index.js";
import type { RuntimeMutator } from "./../../modules/runtime-delivery/index.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { ChannelSecretStore } from "./../../modules/channels/infrastructure/channel-secret-store.js";
import type { IdentityLinkService } from "./../../modules/channels/services/identity-link-service.js";
import type { SlackOAuthPending } from "../../modules/channels/infrastructure/slack.js";
import {
  composeApprovalsService,
  type ApprovalsRelayService,
  type WrapperFrameSender,
} from "./../../modules/approvals/compose.js";
import { injectChannelOf } from "./../../modules/approvals/infrastructure/acp-frames.js";
import {
  composeEgressRulesModule,
  createConnectionRulesSyncAdapter,
  createEgressRuleWriterAdapter,
  createK8sAllowOnlySecretsPort,
} from "./../../modules/egress-rules/compose.js";
import type {
  AgentCleanupHook,
  PresetSeeder,
} from "../../modules/agents/compose.js";
import type { RedisBus } from "../../core/redis-bus.js";
import { emit, EventType, type TurnOutcome } from "../../events.js";

export interface ApiServerAppDeps {
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  channelSecretStore: ChannelSecretStore;
  identityLinkService: IdentityLinkService;
  pendingSlackOAuthFlows: Map<string, SlackOAuthPending>;
  pendingTelegramOAuthFlows: Map<string, TelegramOAuthPending>;
  seedSources: SkillSourceSeed[];
  redisBus: RedisBus;
  approvalsRelay: ApprovalsRelayService;
  wrapperFrameSender: WrapperFrameSender;
  presetSeeder: PresetSeeder;
  trustedHosts: readonly string[];
  /** Hooks fired after a successful agent K8s delete. Each one clears its
   *  module's per-agent durable state; the orphan-sweeper saga is the
   *  belt-and-suspenders for anything missed here. */
  agentCleanupHooks: readonly AgentCleanupHook[];
  secretStores: SecretStoreRegistry;
  runtimeMutator: RuntimeMutator;
  contributionsSettled: ContributionsSettledPort;
  schedulesBoot: SchedulesBoot;
  mountUsageRoutes: (
    app: Hono<{ Variables: { user: UserIdentity; roles: string[] } }>,
  ) => void;
  terms: TermsService;
  isTermsAccepted: IsAcceptedPort;
  e2e: E2eService;
}

export function startApiServerApp(deps: ApiServerAppDeps) {
  const {
    config,
    api,
    db,
    channelManager,
    channelSecretStore,
    identityLinkService,
    pendingSlackOAuthFlows,
    pendingTelegramOAuthFlows,
    seedSources,
    redisBus,
    approvalsRelay,
    wrapperFrameSender,
    presetSeeder,
    trustedHosts,
    agentCleanupHooks,
    secretStores,
    runtimeMutator,
    contributionsSettled,
    schedulesBoot,
    terms,
    isTermsAccepted,
    e2e,
  } = deps;

  const k8sClient = createK8sClient(api, config.namespace);
  const agentsRepo = createAgentsRepository(k8sClient, contributionsSettled);

  const connectionsBoot = composeConnectionsAtBoot({
    db,
    secretStore: secretStores.default(),
    operatorCredentials: {
      ...(config.defaultGithubClientId && config.defaultGithubClientSecret
        ? {
            github: {
              clientId: config.defaultGithubClientId,
              clientSecret: config.defaultGithubClientSecret,
              ...(config.defaultGithubAppSlug
                ? { appSlug: config.defaultGithubAppSlug }
                : {}),
            },
          }
        : {}),
      githubEnterprise: {
        ...(config.defaultGithubEnterpriseHost
          ? { host: config.defaultGithubEnterpriseHost }
          : {}),
        ...(config.defaultGithubEnterpriseClientId
          ? { clientId: config.defaultGithubEnterpriseClientId }
          : {}),
        ...(config.defaultGithubEnterpriseClientSecret
          ? { clientSecret: config.defaultGithubEnterpriseClientSecret }
          : {}),
        ...(config.defaultGithubEnterpriseAppSlug
          ? { appSlug: config.defaultGithubEnterpriseAppSlug }
          : {}),
      },
    },
  });
  connectionsBoot.refreshLoop.start();

  const userDirectory = createKeycloakUserDirectory({
    keycloakUrl: config.keycloakUrl,
    keycloakRealm: config.keycloakRealm,
    clientId: config.keycloakApiClientId,
    clientSecret: config.keycloakApiClientSecret,
  });

  const auth = createAuth({
    issuerUrl: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
    jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
    audience: config.keycloakApiAudience,
    requiredRole: config.keycloakRequiredRole,
    uiClientId: config.keycloakClientId,
    cliClientId: config.keycloakCliClientId,
    coreRole: config.keycloakInspectorRole,
  });

  const slackOauthCallbackUrl =
    config.slackOauthCallbackUrl ??
    `${config.uiBaseUrl}/api/slack/oauth/callback`;

  const app = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/version", (c) =>
    c.json({
      serverVersion: config.serverVersion,
      ...(config.minClientCliVersion !== undefined && {
        minClientVersion: config.minClientCliVersion,
      }),
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
  // Public — UI fetches this on bootstrap (before auth) to set the page
  // title, theme-color meta, and CSS accent custom properties. Sole source
  // of brand truth; all UI components read from here, never from build-time
  // constants.
  app.get("/api/brand", (c) => c.json(config.brand satisfies Brand));
  app.get("/api/terms", (c) => c.json(terms.document()));
  // Public — PWA manifest (replaces the build-time bundled one). Served
  // dynamically so the installed-PWA name follows brand without a UI rebuild.
  app.get("/api/brand/manifest.webmanifest", (c) => {
    c.header("Content-Type", "application/manifest+json");
    return c.body(
      JSON.stringify({
        name: config.brand.name,
        short_name: config.brand.name,
        description: "AI agent platform",
        theme_color: config.brand.theme.light.accent,
        background_color: "#fafaf9",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/api/brand/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/api/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/api/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      }),
    );
  });
  // Brand icon — single SVG source, rasterized on demand by sharp. Override
  // via Helm `brand.icon` (passed as BRAND_ICON_SVG env var); falls back to
  // the bundled default. Public.
  mountBrandIconRoutes(app);

  app.use("/api/*", auth.middleware);
  const termsGate = createTermsGate({ terms });
  app.use("/api/*", termsGate.middleware);

  app.route(
    "/",
    createOAuthRoutes({
      db,
      secretStore: secretStores.default(),
      engine: connectionsBoot.oauthEngine,
      templates: connectionsBoot.templates,
      uiBaseUrl: config.uiBaseUrl,
    }),
  );

  deps.mountUsageRoutes(app);

  if (config.slackBotToken && config.slackAppToken) {
    app.route(
      "/",
      createSlackOAuthRoutes({
        pendingFlows: pendingSlackOAuthFlows,
        identityLinks: identityLinkService,
        brandShort: config.brand.short,
        oauthConfig: {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: slackOauthCallbackUrl,
        },
      }),
    );
  }

  if (config.telegramEnabled) {
    app.route(
      "/",
      createTelegramOAuthRoutes({
        pendingFlows: pendingTelegramOAuthFlows,
        threads: {
          isAuthorized: isThreadAuthorized(db),
          authorize: authorizeThread(db),
          list: listAuthorizedThreads(db),
          revoke: revokeThread(db),
          getAuthorizedBy: getAuthorizedBy(db),
        },
        isAgentOwner: (agentId, sub) => agentsRepo.isOwnedBy(agentId, sub),
        oauthConfig: {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: `${config.uiBaseUrl}/api/telegram/oauth/callback`,
        },
      }),
    );
  }

  async function verifyOwner(agentId: string, owner: string): Promise<boolean> {
    return agentsRepo.isOwnedBy(agentId, owner);
  }

  app.all("/api/agents/:id/trpc/*", async (c) => {
    const user = c.get("user");
    const agentId = c.req.param("id")!;
    if (!(await verifyOwner(agentId, user.sub))) {
      // The 404 is otherwise indistinguishable from a genuinely missing
      // agent — log the cross-tenant access attempt.
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        agentId,
        decision: "deny",
        reason: "not-owner",
        sourceIp: clientIp(c),
        detail: { surface: "trpc-proxy" },
      });
      return c.json({ error: "not found" }, 404);
    }

    // No Bearer swap needed: ownership is verified above, and the agent
    // pod's NetworkPolicy admits ingress only from the api-server pod —
    // the kernel-level gate is the auth boundary on this hop.
    const rest = c.req.path.replace(`/api/agents/${agentId}/trpc`, "");
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
    const upstreamUrl = `http://${podBaseUrl(agentId, config.namespace)}/api/trpc${rest}${qs}`;
    try {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("host");
      headers.delete("authorization");
      const upstream = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body:
          c.req.method !== "GET" && c.req.method !== "HEAD"
            ? c.req.raw.body
            : undefined,
        // @ts-expect-error -- node fetch supports duplex
        duplex: "half",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch {
      return c.json({ error: "agent unreachable" }, 502);
    }
  });

  // File import — bundle is a tar (or tar.gz) inside multipart/form-data;
  // we wake the pod via the reachability primitive and stream the body
  // straight to agent-runtime, which lands it under `<homeDir>/work`
  // with top-level replace semantics. See docs/adrs/045-file-import.md.
  //
  // The proxy uses node:http directly (NOT undici fetch). undici buffers
  // arbitrary-sized request bodies in memory even with `duplex: "half"`,
  // which OOMs the api-server pod on multi-GB uploads. node:http with a
  // raw stream pipe respects backpressure end-to-end so memory stays
  // flat regardless of body size.
  const PROXY_RESPONSE_HEADER_ALLOWLIST = new Set([
    "content-type",
    "content-length",
  ]);
  // RFC 7230 §6.1 hop-by-hop headers + auth — never forwarded upstream.
  // `transfer-encoding: chunked` alongside `content-length` from a buggy
  // or hostile client is a request-smuggling shape; strip both `te` and
  // `transfer-encoding` so the upstream sees only a single consistent
  // framing signal.
  const PROXY_HOP_BY_HOP_HEADERS = new Set([
    "host",
    "authorization",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "expect",
  ]);
  // Reachability preflight: the api-server→pod mesh route can lag kubelet-Ready
  // on a freshly-rolled pod. fetch resolving (any status) proves the path is live;
  // a reject is a connection error → retry (300ms→2s backoff, 15s budget).
  const awaitImportPathLive = (agentId: string): Promise<boolean> => {
    const url = `http://${podBaseUrl(agentId, config.namespace)}/healthz`;
    return pollUntilReady(
      () =>
        fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
          () => true,
          () => false,
        ),
      300,
      2_000,
      15_000,
    );
  };
  type ImportCtx = Context<{
    Variables: { user: UserIdentity; roles: string[] };
  }>;
  async function proxyImport(c: ImportCtx) {
    const user = c.get("user");
    const agentId = c.req.param("id")!;
    if (!(await verifyOwner(agentId, user.sub))) {
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        agentId,
        decision: "deny",
        reason: "not-owner",
        sourceIp: clientIp(c),
        detail: { surface: "import" },
      });
      return c.json({ error: "not found" }, 404);
    }
    // Hard byte ceiling at the proxy boundary. Requires Content-Length so
    // a chunked-encoding client can't slip past the cap; we additionally
    // enforce the cap with a streaming byte counter below, so a client
    // lying with `Content-Length: 1` can't trickle bytes past us.
    const lengthHeader = c.req.header("content-length");
    if (!lengthHeader) {
      return c.json(
        { error: "Content-Length required for import upload" },
        411,
      );
    }
    const length = Number.parseInt(lengthHeader, 10);
    if (!Number.isFinite(length) || length < 0) {
      return c.json({ error: "invalid Content-Length" }, 400);
    }
    // Per-attempt marker state machine (single-shot). The bundle lives with the
    // client, so the api-server stays stateless: on a roll/transient failure it
    // returns a retryable 503 and the client re-POSTs (idempotent finalize on the
    // agent). Failure is explicit (fatal 4xx / give-up) — never inferred from the TTL.
    const isFinal = c.req.query("final") === "1";
    let settled = false;
    const emitOutcome = (outcome: TurnOutcome) =>
      emit({
        type: EventType.FilesImported,
        actorSub: user.sub,
        agentId,
        outcome,
        bytes: length,
      });
    // Set the failure reason → the degraded badge; `importPending` flips false on its own.
    const markFailed = (reason: string) =>
      void agentsRepo
        .patchAnnotation(agentId, ANN_IMPORT_ERROR, reason)
        .catch(() => {});
    const onSuccess = () => {
      if (settled) return;
      settled = true;
      // Clear both markers → "running" can proceed with no stale badge.
      void agentsRepo
        .patchAnnotations(agentId, {
          [ANN_PENDING_IMPORT]: "",
          [ANN_IMPORT_ERROR]: "",
        })
        .catch(() => {});
      emitOutcome("success");
    };
    const onFatal = (reason: string) => {
      if (settled) return;
      settled = true;
      markFailed(reason); // won't succeed on retry
      emitOutcome("failure");
    };
    // Transient: leave the fresh in-progress marker so the agent stays "starting"
    // and the client retries — unless this is the client's final attempt, recorded
    // as an explicit failure (instant badge instead of waiting on the crash-net TTL).
    const onRetryable = (reason: string) => {
      if (settled) return;
      settled = true;
      if (isFinal) {
        markFailed(reason);
        emitOutcome("failure");
      }
    };

    if (length > config.maxImportBundleBytes) {
      onFatal(
        `bundle exceeds maximum size of ${config.maxImportBundleBytes} bytes`,
      );
      return c.json(
        {
          error: `bundle exceeds maximum size of ${config.maxImportBundleBytes} bytes`,
        },
        413,
      );
    }

    // Mark this attempt in progress (awaited so any terminal marker below wins the
    // race): gates "running", and clears a prior error so a retry or re-import
    // re-enters "starting".
    await agentsRepo
      .patchAnnotations(agentId, {
        [ANN_PENDING_IMPORT]: new Date().toISOString(),
        [ANN_IMPORT_ERROR]: "",
      })
      .catch(() => {});

    try {
      // Only needs the pod reachable + not terminating — the retry (client re-POST
      // on 503) handles any roll, so we react to one rather than anticipate it.
      await agentsRepo.ensureImportable(agentId);
    } catch (err) {
      process.stderr.write(
        `[import-proxy] ensureImportable failed for ${agentId}: ${(err as Error).message}\n`,
      );
      onRetryable("instance unreachable");
      return c.json({ error: "instance unreachable; retry" }, 503);
    }
    // Gate on the actual api-server→pod path being live before the upload.
    if (!(await awaitImportPathLive(agentId))) {
      process.stderr.write(
        `[import-proxy] path not reachable for ${agentId} after preflight\n`,
      );
      onRetryable("instance unreachable");
      return c.json({ error: "instance unreachable; retry" }, 503);
    }
    const upstreamUrl = new URL(
      `http://${podBaseUrl(agentId, config.namespace)}/api/import`,
    );
    const outHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => {
      if (PROXY_HOP_BY_HOP_HEADERS.has(k.toLowerCase())) return;
      outHeaders[k] = v;
    });

    return new Promise<Response>((resolve) => {
      // Single-shot resolve guard. Without this, both the upstream
      // response handler and the error/close handlers can race —
      // resulting in either a double-resolve (no-op in practice but
      // confusing) or, more importantly, a Promise that never resolves
      // when the *client* aborts before any upstream event fires
      // (Node may emit `close` without `error` on upstreamReq, which
      // would otherwise dangle).
      let resolved = false;
      const resolveOnce = (resp: Response) => {
        if (resolved) return;
        resolved = true;
        resolve(resp);
      };
      const upstreamReq = httpRequest(
        {
          protocol: upstreamUrl.protocol,
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port,
          path: upstreamUrl.pathname + upstreamUrl.search,
          method: "POST",
          headers: outHeaders,
        },
        (upstreamRes) => {
          const status = upstreamRes.statusCode ?? 502;
          if (status >= 200 && status < 300) {
            onSuccess();
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
              if (value === undefined) continue;
              if (!PROXY_RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase()))
                continue;
              responseHeaders.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
            }
            // toWeb gives a Web ReadableStream backed by the IncomingMessage —
            // Hono streams this back to the client without buffering.
            const body = Readable.toWeb(
              upstreamRes,
            ) as ReadableStream<Uint8Array>;
            resolveOnce(
              new Response(body, { status, headers: responseHeaders }),
            );
            return;
          }
          upstreamRes.resume(); // discard the error body
          if (status === 409 || status >= 500) {
            // Import already in flight / agent hiccup — transient, client retries.
            onRetryable(`agent returned ${status}`);
            resolveOnce(
              c.json({ error: "import temporarily unavailable; retry" }, 503),
            );
          } else {
            // Agent rejected the bundle (e.g. validation) — fatal, do not retry.
            onFatal(`agent rejected import (${status})`);
            resolveOnce(c.json({ error: "import rejected" }, 422));
          }
        },
      );
      upstreamReq.on("error", () => {
        // Connection reset — typically the pod rolled mid-transfer; client retries.
        onRetryable("connection reset");
        resolveOnce(c.json({ error: "instance unreachable; retry" }, 503));
      });
      upstreamReq.on("close", () => {
        // Socket closed without a response (mid-request abort) — retry.
        onRetryable("connection closed");
        resolveOnce(
          c.json({ error: "instance closed connection; retry" }, 503),
        );
      });

      // Pipe incoming request body straight into the upstream socket.
      // Wrap with a Transform that counts bytes when the cap is on, so
      // even a lying Content-Length client can't trickle past the limit.
      const incomingBody = c.req.raw.body;
      if (!incomingBody) {
        upstreamReq.end();
        return;
      }
      const source = Readable.fromWeb(
        incomingBody as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      let seen = 0;
      const cap = config.maxImportBundleBytes;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          seen += chunk.length;
          if (seen > cap) {
            cb(new Error(`bundle exceeds cap ${cap}B`));
            return;
          }
          cb(null, chunk);
        },
      });
      counter.on("error", () => {
        try {
          upstreamReq.destroy();
        } catch {}
        onFatal(`bundle exceeds maximum size of ${cap} bytes`);
        resolveOnce(
          c.json({ error: `bundle exceeds maximum size of ${cap} bytes` }, 413),
        );
      });
      counter.pipe(upstreamReq);
      source
        .on("error", () => {
          try {
            upstreamReq.destroy();
          } catch {}
        })
        .pipe(counter);
    });
  }
  app.post("/api/agents/:id/import", (c) => proxyImport(c));

  app.all("/api/trpc/*", (c) => {
    const user = c.get("user");

    const { templates, readSpec: readTemplateSpec } = composeTemplatesModule(
      api,
      config.namespace,
    );
    const { agents, isOwnedAgent } = composeAgentsModule({
      api,
      namespace: config.namespace,
      owner: user.sub,
      db,
      userDirectory,
      channelSecretStore,
      readTemplateSpec,
      presetSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator,
      contributionsSettled,
    });
    const { schedules } = composeSchedulesForOwner({
      boot: schedulesBoot,
      owner: user.sub,
      agentExists: async (agentId) => (await agents.get(agentId)) !== null,
    });
    const skills = composeSkillsModule(
      api,
      config.namespace,
      user.sub,
      db,
      seedSources,
      config.brand.name,
      runtimeMutator,
      contributionsSettled,
    );
    const grants = createAgentGrantsPort(k8sClient, user.sub);
    const secrets = createSecretsService({
      k8sPort: createK8sSecretsPort(k8sClient, user.sub),
      grants,
      connectionRules: createConnectionRulesSyncAdapter(db),
      ownerSub: user.sub,
    });
    const connections = composeConnectionsForOwner({
      ownerId: user.sub,
      db,
      templates: connectionsBoot.templates,
      oauthEngine: connectionsBoot.oauthEngine,
      secretStore: secretStores.default(),
      runtimeMutator,
      agentsRepo,
      connectionRulesSync: createConnectionRulesSyncAdapter(db),
      oauthCallbackUrl: `${config.uiBaseUrl}/api/oauth/callback`,
      brandName: config.brand.name,
    });
    const isAgentOwnedBy = async (agentId: string, ownerSub: string) =>
      (await agents.get(agentId)) !== null && ownerSub === user.sub;
    const { service: egressRules } = composeEgressRulesModule({
      db,
      ownerSub: user.sub,
      isAgentOwnedBy,
      allowOnlySecrets: createK8sAllowOnlySecretsPort(k8sClient),
      presetSeeder,
      trustedHosts,
    });
    const { service: approvals } = composeApprovalsService({
      db,
      ownerSub: user.sub,
      isAgentOwnedBy: (agentId, ownerSub) =>
        agentsRepo.isOwnedBy(agentId, ownerSub),
      egressRuleWriter: createEgressRuleWriterAdapter(db),
      bus: redisBus,
      wrapperFrameSender,
    });
    const files = composeFilesModule(
      api,
      config.namespace,
      user.sub,
      contributionsSettled,
    );

    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): ApiContext => ({
        templates,
        agents,
        schedules,
        secrets,
        channels: { available: channelManager.availableChannels() },
        connections,
        skills,
        approvals,
        egressRules,
        files,
        terms,
        e2e,
        user,
        e2eEnabled: config.e2eEnabled,
      }),
    });
  });

  const acpRelay = createAcpRelay(
    config.namespace,
    agentsRepo,
    approvalsRelay,
    {
      resolve: (id) =>
        agentsRepo
          .resolveIdentity(id)
          .then((r) => (r ? { ownerSub: r.owner, agentId: r.agentId } : null)),
    },
  );

  const terminalRelay = createTerminalRelay(config.namespace, agentsRepo);

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    process.stderr.write(
      `api-server listening on http://localhost:${config.port}\n`,
    );
  });
  // Node defaults `requestTimeout` to 5 minutes — that hard-caps the
  // file-import proxy roundtrip, because we hold the request open until
  // the agent-runtime finishes extracting + finalizing the bundle, and
  // a multi-GB tar can take well over 5 minutes end-to-end.
  // `server.requestTimeout` is an absolute timer set at request start
  // (not socket-idle), so there's no public Node API to scope it
  // per-handler; disable it server-wide instead.
  //
  // What's lost: the body-read timeout on every other route. What still
  // protects them:
  //   - `headersTimeout = 60s` bounds the headers phase on every route.
  //   - tRPC and other non-import routes have hard body caps, so a slow
  //     body ties up a TCP connection but can't grow memory.
  //   - This pod sits behind Traefik, which has its own ingress timeouts.
  // The agent-runtime applies its own inactivity (30s) + wall-clock
  // (30min) deadlines on the import path, so stuck imports still abort.
  //
  // @hono/node-server's ServerType is the union of http/https/http2
  // server types; cast to access the timeout fields directly.
  const nodeServer = server as unknown as {
    requestTimeout: number;
    headersTimeout: number;
  };
  nodeServer.requestTimeout = 0;
  nodeServer.headersTimeout = 60_000;

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const match = url.pathname.match(
      /^\/api\/agents\/([^/]+)\/(acp|terminal)$/,
    );
    if (!match) {
      socket.destroy();
      return;
    }

    // `relayKind` and `agentId` identify the target credentialed pod; the
    // token rides in the query string and must NEVER be logged (only the
    // pathname, which carries no secret).
    const relayKind = match[2]!; // "acp" | "terminal"
    const agentId = decodeURIComponent(match[1]!);
    const fwd = req.headers["x-forwarded-for"];
    const sourceIp =
      (typeof fwd === "string" ? fwd.split(",")[0]!.trim() : undefined) ??
      req.socket.remoteAddress ??
      undefined;

    const token = url.searchParams.get("token");
    if (!token) {
      securityLog("warn", "ws.authn_deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        surface: "ws",
        agentId,
        decision: "deny",
        reason: "missing-token",
        sourceIp,
        detail: { relay: relayKind },
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let user: UserIdentity;
    try {
      user = (await auth.verify(token)).user;
    } catch (err) {
      const forbidden = err instanceof ForbiddenError;
      securityLog("warn", forbidden ? "ws.authz_deny" : "ws.authn_deny", {
        category: forbidden ? "authz" : "authn",
        actor: forbidden ? err.sub : null,
        actorKind: forbidden ? "user" : "external",
        surface: "ws",
        agentId,
        decision: "deny",
        reason: forbidden
          ? "missing-required-role"
          : err instanceof Error
            ? err.name
            : "verify-failed",
        sourceIp,
        detail: { relay: relayKind },
      });
      socket.write(
        `HTTP/1.1 ${forbidden ? "403 Forbidden" : "401 Unauthorized"}\r\n\r\n`,
      );
      socket.destroy();
      return;
    }

    if (!(await verifyOwner(agentId, user.sub))) {
      securityLog("warn", "ws.owner_mismatch", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        surface: "ws",
        agentId,
        decision: "deny",
        reason: "not-owner",
        sourceIp,
        detail: { relay: relayKind },
      });
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!(await isTermsAccepted(user.sub))) {
      securityLog("warn", "ws.terms_block", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        surface: "ws",
        agentId,
        decision: "deny",
        reason: "terms-not-accepted",
        sourceIp,
        detail: { relay: relayKind },
      });
      socket.write("HTTP/1.1 412 Precondition Failed\r\n\r\n");
      socket.destroy();
      return;
    }

    // Success: a human (or token-bearer) is attaching to a credentialed pod —
    // an interactive shell (terminal) or prompt channel (acp). High-value
    // forensic event in its own right.
    securityLog("info", "relay.attach", {
      category: "privileged",
      actor: user.sub,
      actorKind: "user",
      surface: "ws",
      agentId,
      result: "success",
      sourceIp,
      detail: { relay: relayKind },
    });
    const relay = relayKind === "acp" ? acpRelay : terminalRelay;
    relay.handleUpgrade(req, socket, head, agentId);
  });

  return { server };
}
