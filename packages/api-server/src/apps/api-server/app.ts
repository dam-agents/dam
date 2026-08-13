import { serve } from "@hono/node-server";
import type { UserIdentity } from "api-server-api";
import { Hono, type MiddlewareHandler } from "hono";
import { except } from "hono/combine";
import {
  authenticatePrincipal,
  createAuthMiddleware,
  createTermsGate,
  isTermsOnlyTrpcCall,
  type Authenticate,
  type AuthSite,
} from "./admission/index.js";
import {
  createAcpRelay,
  createAgentTrpcProxy,
  createImportProxy,
  createRelayAdmission,
  createSshRelay,
  createTerminalRelay,
  createUpgradeHandler,
  relayRoute,
  selfAuthenticated,
} from "./agent-proxies/index.js";
import type { ApiServerDeps } from "./deps.js";
import { mountRoutes } from "./routes/index.js";
import {
  createApiContextFactory,
  createTrpcHttpHandler,
  createTrpcWsEndpoint,
} from "./trpc/index.js";

export type { ApiServerDeps } from "./deps.js";

/** Baseline security headers for every app response (JSON API + the brand
 *  asset routes). The static UI sets its own equivalents in
 *  packages/ui/default.conf; nothing here overlaps with the share viewer,
 *  which the share-host gate already returned from for its own host. */
const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
};

/** The complete public surface: an /api endpoint skips authentication if
 *  and only if it is listed here (fail-closed — a missing entry 401s
 *  instead of silently exposing). */
const PUBLIC_PATHS = [
  "/api/health",
  "/api/ready",
  // Unauthenticated by contract: the CLI's compatibility-floor check.
  "/api/version",
  "/api/auth/config",
  // Fetched by the UI on bootstrap, before any login (exact path; the
  // wildcard below covers the manifest and rasterized icons).
  "/api/brand",
  "/api/brand/*",
  "/api/oauth/callback",
  "/api/slack/oauth/callback",
  "/api/telegram/oauth/callback",
  "/api/terms",
];

/** Builds and starts the api-server Hono app from the pre-assembled deps.
 *  Pure surface wiring: it constructs no singletons (bootstrap did that) —
 *  it composes the HTTP pipeline and the WebSocket surfaces and returns the
 *  server handle plus the events-socket endpoint for the caller to manage. */
export function startApiServerApp(deps: ApiServerDeps) {
  const { config } = deps;
  const verifyOwner = (agentId: string, ownerSub: string) =>
    deps.agentsRepo.isOwnedBy(agentId, ownerSub);
  const ensureReady = (agentId: string) => deps.agentsRepo.ensureReady(agentId);
  const composeApiContext = createApiContextFactory(deps);

  // The one authentication decision, shared verbatim by every surface —
  // the HTTP chain, the agent relays, and the tRPC WS endpoint.
  const authenticate: Authenticate = (token, site: AuthSite) =>
    authenticatePrincipal(deps.auth.verify, token, site);
  const termsGate = createTermsGate({ terms: deps.terms });

  const app = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  // ── HTTP pipeline, in order ────────────────────────────────────────────
  app.use("*", deps.shareHostGate); //          share host → viewer app only
  app.use("*", securityHeaders); //             baseline headers, every response
  app.use(
    "/api/*", //                                authn: bearer per request
    except(
      PUBLIC_PATHS,
      createAuthMiddleware(authenticate, deps.surfaceAttribution),
    ),
  );
  app.use(
    "/api/*", //                                platform gate: terms accepted
    except((c) => isTermsOnlyTrpcCall(c.req.path), termsGate.middleware),
  );
  mountRoutes(app, deps); //                    routes/: bootstrap endpoints,
  //                                            oauth, usage, artifact binaries
  app.all("/api/trpc/*", createTrpcHttpHandler({ composeApiContext }));
  app.all(
    "/api/agents/:id/trpc/*",
    createAgentTrpcProxy({
      namespace: config.namespace,
      verifyOwner,
      ensureReady,
    }),
  );
  app.post(
    "/api/agents/:id/import",
    createImportProxy({
      namespace: config.namespace,
      maxImportBundleBytes: config.maxImportBundleBytes,
      verifyOwner,
      ensureReady,
    }),
  );

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      serverOptions: {
        // The import proxy holds requests open for multi-GB uploads, so
        // Node's default 5-minute requestTimeout must go — it cannot be
        // scoped per-handler. See import-proxy.ts for the compensating
        // limits; headersTimeout still bounds the headers phase everywhere.
        requestTimeout: 0,
        headersTimeout: 60_000,
      },
    },
    () => {
      process.stderr.write(
        `api-server listening on http://localhost:${config.port}\n`,
      );
    },
  );

  // ── WebSocket surfaces: path → auth model → target ─────────────────────
  const trpcWs = createTrpcWsEndpoint({
    authenticate,
    surfaceAttribution: deps.surfaceAttribution,
    isTermsAccepted: deps.isTermsAccepted,
    composeApiContext,
  });
  // Query-token admission shared by the agent relays: authn → owner →
  // operate-scope + binding → terms, before any attach.
  const relayAdmission = createRelayAdmission({
    authenticate,
    verifyOwner,
    isTermsAccepted: deps.isTermsAccepted,
  });
  const acpRelay = createAcpRelay(
    config.namespace,
    deps.agentsRepo,
    deps.approvalsRelay,
    deps.sessionPresence,
  );
  const terminalRelay = createTerminalRelay(
    config.namespace,
    deps.agentsRepo,
    deps.sessionPresence,
  );
  const sshRelay = createSshRelay(
    config.namespace,
    deps.agentsRepo,
    deps.sessionPresence,
  );

  server.on(
    "upgrade",
    createUpgradeHandler({
      // Authenticates in-protocol: token in frame 1 (tRPC connectionParams),
      // then terms, then procedures.
      "/api/trpc-ws": selfAuthenticated(trpcWs),
      // Query-token admission before attach: authn → owner → scope+binding → terms.
      "/api/agents/:id/acp": relayRoute(relayAdmission, acpRelay, "acp"),
      "/api/agents/:id/terminal": relayRoute(
        relayAdmission,
        terminalRelay,
        "terminal",
      ),
      "/api/agents/:id/ssh": relayRoute(relayAdmission, sshRelay, "ssh"),
    }),
  );

  return { server, trpcWs };
}
