import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import type { ApiContext, UserIdentity } from "api-server-api";
import type { CoreV1Api } from "@kubernetes/client-node";
import type { Db } from "db";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import {
  createK8sClient, podBaseUrl,
} from "../../modules/agents/infrastructure/k8s.js";
import { createInstancesRepository } from "./../../modules/agents/infrastructure/instances-repository.js";
import { composeAgentsModule } from "../../modules/agents/index.js";
import { createKeycloakUserDirectory } from "../../modules/agents/infrastructure/keycloak-user-directory.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import { createAgentTokenResolver } from "../../modules/skills/infrastructure/agent-token.js";
import { createSlackOAuthRoutes } from "../../modules/channels/infrastructure/slack-oauth.js";
import { createTelegramOAuthRoutes } from "../../modules/channels/infrastructure/telegram-oauth.js";
import type { TelegramOAuthPending } from "../../modules/channels/infrastructure/telegram.js";
import {
  isThreadAuthorized, authorizeThread, revokeThread, listAuthorizedThreads,
} from "../../modules/channels/infrastructure/telegram-threads-repository.js";
import { createAcpRelay } from "./acp-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { createOAuthAppRegistry } from "../../modules/connections/infrastructure/oauth-apps.js";
import type { Config } from "../../config.js";
import { createAuth, ForbiddenError } from "./auth.js";
import { createK8sSecretsPort } from "./../../modules/secrets/infrastructure/k8s-secrets-port.js";
import { createSecretsService } from "./../../modules/secrets/services/secrets-service.js";
import { createK8sConnectionsPort } from "./../../modules/connections/infrastructure/k8s-connections-port.js";
import { createConnectionsService } from "./../../modules/connections/services/connections-service.js";
import { createAgentGrantsPort } from "./../../modules/agents/infrastructure/agent-grants-port.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { ChannelSecretStore } from "./../../modules/channels/infrastructure/channel-secret-store.js";
import type { IdentityLinkService } from "./../../modules/channels/services/identity-link-service.js";
import type { SlackOAuthPending } from "../../modules/channels/infrastructure/slack.js";
import type { PodFilesPublisher } from "../../modules/pod-files/publisher.js";
import {
  composeApprovalsService,
  type ApprovalsRelayService,
  type WrapperFrameSender,
} from "./../../modules/approvals/compose.js";
import {
  composeEgressRulesModule,
  createConnectionRulesSyncAdapter,
  createEgressRuleWriterAdapter,
  createK8sAllowOnlySecretsPort,
} from "./../../modules/egress-rules/compose.js";
import type { AgentCleanupHook, PresetSeeder } from "../../modules/agents/compose.js";
import type { RedisBus } from "../../core/redis-bus.js";

export interface ApiServerAppDeps {
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  channelSecretStore: ChannelSecretStore;
  identityLinkService: IdentityLinkService;
  pendingSlackOAuthFlows: Map<string, SlackOAuthPending>;
  pendingTelegramOAuthFlows: Map<string, TelegramOAuthPending>;
  podFilesPublisher: PodFilesPublisher;
  seedSources: SkillSourceSeed[];
  redisBus: RedisBus;
  approvalsRelay: ApprovalsRelayService;
  wrapperFrameSender: WrapperFrameSender;
  presetSeeder: PresetSeeder;
  trustedHosts: readonly string[];
  appConnectionEgressHosts: ReadonlyMap<string, readonly string[]>;
  /** Hooks fired after a successful agent K8s delete. Each one clears its
   *  module's per-agent durable state; the orphan-sweeper saga is the
   *  belt-and-suspenders for anything missed here. */
  agentCleanupHooks: readonly AgentCleanupHook[];
}

export function startApiServerApp(deps: ApiServerAppDeps) {
  const {
    config, api, db, channelManager, channelSecretStore, identityLinkService,
    pendingSlackOAuthFlows, pendingTelegramOAuthFlows, podFilesPublisher, seedSources,
    redisBus, approvalsRelay, wrapperFrameSender, presetSeeder, trustedHosts,
    appConnectionEgressHosts, agentCleanupHooks,
  } = deps;

  const k8sClient = createK8sClient(api, config.namespace);
  const instancesRepo = createInstancesRepository(k8sClient);
  const getAgentToken = createAgentTokenResolver(k8sClient);

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
  });

  const slackOauthCallbackUrl = config.slackOauthCallbackUrl
    ?? `${config.uiBaseUrl}/api/slack/oauth/callback`;

  const app = new Hono<{ Variables: { user: UserIdentity } }>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/auth/config", (c) =>
    c.json({
      issuer: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
      clientId: config.keycloakClientId,
    }),
  );

  app.use("/api/*", auth.middleware);

  const oauthApps = createOAuthAppRegistry({
    github: {
      ...(config.defaultGithubClientId ? { clientId: config.defaultGithubClientId } : {}),
      ...(config.defaultGithubClientSecret ? { clientSecret: config.defaultGithubClientSecret } : {}),
    },
    githubEnterprise: {
      ...(config.defaultGithubEnterpriseHost ? { host: config.defaultGithubEnterpriseHost } : {}),
      ...(config.defaultGithubEnterpriseClientId ? { clientId: config.defaultGithubEnterpriseClientId } : {}),
      ...(config.defaultGithubEnterpriseClientSecret ? { clientSecret: config.defaultGithubEnterpriseClientSecret } : {}),
    },
  });
  app.route(
    "/",
    createOAuthRoutes({ uiBaseUrl: config.uiBaseUrl, k8sClient, apps: oauthApps }),
  );

  if (config.slackBotToken && config.slackAppToken) {
    app.route("/", createSlackOAuthRoutes({
      pendingFlows: pendingSlackOAuthFlows,
      identityLinks: identityLinkService,
      oauthConfig: {
        keycloakExternalUrl: config.keycloakExternalUrl,
        keycloakUrl: config.keycloakUrl,
        keycloakRealm: config.keycloakRealm,
        keycloakClientId: config.keycloakClientId,
        callbackUrl: slackOauthCallbackUrl,
      },
    }));
  }

  if (config.telegramEnabled) {
    app.route("/", createTelegramOAuthRoutes({
      pendingFlows: pendingTelegramOAuthFlows,
      threads: {
        isAuthorized: isThreadAuthorized(db),
        authorize: authorizeThread(db),
        list: listAuthorizedThreads(db),
        revoke: revokeThread(db),
      },
      isInstanceOwner: (instanceId, sub) => instancesRepo.isOwnedBy(instanceId, sub),
      oauthConfig: {
        keycloakExternalUrl: config.keycloakExternalUrl,
        keycloakUrl: config.keycloakUrl,
        keycloakRealm: config.keycloakRealm,
        keycloakClientId: config.keycloakClientId,
        callbackUrl: `${config.uiBaseUrl}/api/telegram/oauth/callback`,
      },
    }));
  }

  async function verifyOwner(instanceId: string, owner: string): Promise<boolean> {
    return instancesRepo.isOwnedBy(instanceId, owner);
  }

  app.all("/api/instances/:id/trpc/*", async (c) => {
    const user = c.get("user");
    const instanceId = c.req.param("id")!;
    if (!await verifyOwner(instanceId, user.sub)) {
      return c.json({ error: "not found" }, 404);
    }

    // Swap the user's JWT for the agent's bearer before forwarding —
    // agent-runtime's tRPC procedures are all `protectedProcedure` and only
    // honor the agent's ONECLI_ACCESS_TOKEN. Ownership has already been
    // verified above, so issuing the agent token here is safe.
    const infra = await instancesRepo.get(instanceId, user.sub);
    if (!infra) return c.json({ error: "not found" }, 404);
    let agentToken: string;
    try {
      agentToken = await getAgentToken(infra.agentId);
    } catch {
      return c.json({ error: "agent token unavailable" }, 502);
    }

    const rest = c.req.path.replace(`/api/instances/${instanceId}/trpc`, "");
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
    const upstreamUrl = `http://${podBaseUrl(instanceId, config.namespace)}/api/trpc${rest}${qs}`;
    try {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("host");
      headers.set("authorization", `Bearer ${agentToken}`);
      const upstream = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
        // @ts-expect-error -- node fetch supports duplex
        duplex: "half",
      });
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    } catch {
      return c.json({ error: "instance unreachable" }, 502);
    }
  });

  app.all("/api/trpc/*", (c) => {
    const user = c.get("user");

    const { templates, agents, instances, schedules, sessions } = composeAgentsModule(api, config.namespace, user.sub, db, userDirectory, channelSecretStore, config.agentHome, presetSeeder, agentCleanupHooks);
    const skills = composeSkillsModule(api, config.namespace, user.sub, db, seedSources);
    const grants = createAgentGrantsPort(k8sClient, user.sub);
    const secrets = createSecretsService({
      k8sPort: createK8sSecretsPort(k8sClient, user.sub),
      grants,
      connectionRules: createConnectionRulesSyncAdapter(db),
      ownerSub: user.sub,
    });
    const connections = createConnectionsService({
      port: createK8sConnectionsPort(k8sClient, user.sub),
      grants,
      owner: user.sub,
      podFiles: podFilesPublisher,
      egressHostsByProvider: appConnectionEgressHosts,
      connectionRules: createConnectionRulesSyncAdapter(db),
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
      isInstanceOwnedBy: (instanceId, ownerSub) => instancesRepo.isOwnedBy(instanceId, ownerSub),
      egressRuleWriter: createEgressRuleWriterAdapter(db),
      bus: redisBus,
      wrapperFrameSender,
    });

    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): ApiContext => ({
        templates,
        agents,
        instances,
        schedules,
        sessions,
        secrets,
        channels: { available: channelManager.availableChannels() },
        connections,
        skills,
        approvals,
        egressRules,
        user,
      }),
    });
  });

  const acpRelay = createAcpRelay(
    config.namespace,
    instancesRepo,
    approvalsRelay,
    { resolve: (id) => instancesRepo.resolveIdentity(id).then((r) => r ? { ownerSub: r.owner, agentId: r.agentId } : null) },
  );

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    process.stderr.write(`api-server listening on http://localhost:${config.port}\n`);
  });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/instances\/([^/]+)\/acp$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let user: UserIdentity;
    try {
      user = await auth.verify(token);
    } catch (err) {
      const status = err instanceof ForbiddenError ? "403 Forbidden" : "401 Unauthorized";
      socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
      socket.destroy();
      return;
    }

    const instanceId = decodeURIComponent(match[1]);
    if (!await verifyOwner(instanceId, user.sub)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    acpRelay.handleUpgrade(req, socket, head, instanceId);
  });

  return { server };
}
