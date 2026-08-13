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

const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
};

const PUBLIC_PATHS = [
  "/api/health",
  "/api/ready",
  "/api/version",
  "/api/auth/config",
  "/api/brand",
  "/api/brand/*",
  "/api/oauth/callback",
  "/api/slack/oauth/callback",
  "/api/telegram/oauth/callback",
  "/api/terms",
];

export function startApiServerApp(deps: ApiServerDeps) {
  const { config } = deps;
  const verifyOwner = (agentId: string, ownerSub: string) =>
    deps.agentsRepo.isOwnedBy(agentId, ownerSub);
  const ensureReady = (agentId: string) => deps.agentsRepo.ensureReady(agentId);
  const composeApiContext = createApiContextFactory(deps);

  const authenticate: Authenticate = (token, site: AuthSite) =>
    authenticatePrincipal(deps.auth.verify, token, site);
  const termsGate = createTermsGate({ terms: deps.terms });

  const app = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  app.use("*", deps.shareHostGate);
  app.use("*", securityHeaders);
  app.use(
    "/api/*",
    except(
      PUBLIC_PATHS,
      createAuthMiddleware(authenticate, deps.surfaceAttribution),
    ),
  );
  app.use(
    "/api/*",
    except((c) => isTermsOnlyTrpcCall(c.req.path), termsGate.middleware),
  );
  mountRoutes(app, deps);
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

  const trpcWs = createTrpcWsEndpoint({
    authenticate,
    surfaceAttribution: deps.surfaceAttribution,
    composeApiContext,
  });
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
      "/api/trpc-ws": selfAuthenticated(trpcWs),
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
