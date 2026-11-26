import type { Db } from "db";
import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  DAM_TEMPLATE_ID,
  type Connection,
  type ConnectionsService,
  type HarnessCatalog,
  type SecretRequestsService,
} from "api-server-api";
import { createXactLock } from "../../core/xact-lock.js";
import { connectionEnv } from "./domain/connection-env.js";
import { readsItself } from "./domain/platform-access.js";
import { getLogger } from "../../core/logger.js";
import { createKbShareResolver } from "../kb-shares/index.js";
import {
  createConnectionsRepository,
  listConnectionsByTemplate,
} from "./infrastructure/connections-repository.js";
import { readConnectionTemplateIds } from "./infrastructure/connection-template-ids.js";
import { createProviderBalanceSource } from "./infrastructure/provider-balance-source.js";
import {
  createOAuthEngine,
  type OAuthEngine,
  type PendingFlow,
} from "./infrastructure/oauth-engine.js";
import type { TtlStore } from "../../core/ttl-store.js";
import {
  createGitHubAppEngine,
  type GitHubAppEngine,
} from "./infrastructure/github-app-engine.js";
import { createS3CredentialProbe } from "./infrastructure/s3-credential-probe.js";
import { createAcceptingS3CredentialProbe } from "./infrastructure/accepting-s3-credential-probe.js";
import type { S3CredentialProbe } from "./domain/s3-credential-probe.js";
import { createProviderKeyProbe } from "./infrastructure/provider-key-probe.js";
import { createMcpToolLister } from "./infrastructure/mcp-tool-lister.js";
import { createAcceptingProviderKeyProbe } from "./infrastructure/accepting-provider-key-probe.js";
import type { ProviderKeyProbe } from "./domain/provider-key-probe.js";
import { createCredentialProbe } from "./infrastructure/credential-probe.js";
import {
  createConnectionTemplateRegistry,
  type ConnectionTemplateRegistry,
} from "./domain/connection-template.js";
import {
  heldToolAccess,
  toolAccessFor,
  type LimitingConnection,
  type McpToolLister,
  type ToolAccessLimit,
} from "./domain/tool-access.js";
import { buildCatalog, type OperatorCredentials } from "./domain/catalog.js";
import {
  createConnectionsService,
  REMOVED_PROVIDER_TEMPLATE_IDS,
  type ManagedProviderConnections,
} from "./services/connections-service.js";
import {
  createProviderModelCatalog,
  type ProviderModelCatalog,
} from "./services/provider-model-catalog.js";
import { loadShippedHarnessFacts } from "./infrastructure/shipped-harness-manifests.js";
import {
  createContributionFanOut,
  type FanOutPort,
} from "./services/contribution-fanout.js";
import { createOAuthFlowService } from "./services/oauth-flow.js";
import {
  createToolCallLabels as createToolCallLabelsService,
  type ToolCallLabels,
} from "./services/tool-call-labels.js";
import { createSecretRequestsService } from "./services/secret-requests.js";
import {
  createAgentSecretRequests,
  type AgentSecretRequests,
} from "./services/agent-secret-requests.js";
import type {
  PendingSecretRequest,
  SecretRequestOutcome,
} from "./domain/secret-request.js";
import {
  providerEgressScopes,
  scopeCovers,
  type ProviderEgressRequest,
} from "./domain/provider-egress-scopes.js";
import {
  createOAuthRefreshLoop,
  type OAuthRefreshLoop,
} from "./services/oauth-refresh.js";
import {
  createAccountLabelBackfill,
  type AccountLabelBackfill,
} from "./services/account-label.js";
import type { SecretStore } from "../secret-store/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { AgentsRepository } from "../agents/infrastructure/agents-repository.js";
import type { ConnectionRulesSync } from "../egress-rules/services/connection-rules-sync.js";
import type { DamKeyPort, DamSkillFile } from "./domain/dam-connection.js";

export interface SecretRequestStores {
  pending: TtlStore<PendingSecretRequest>;
  outcomes: TtlStore<SecretRequestOutcome>;
}

export interface ConnectionsBootCompose {
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  secretRequestStores: SecretRequestStores;
  oauthEngine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  s3CredentialProbe: S3CredentialProbe;
  providerKeyProbe: ProviderKeyProbe;
  mcpToolLister: McpToolLister;
  refreshLoop: OAuthRefreshLoop;
  accountLabelBackfill: AccountLabelBackfill;
  providerModelCatalog: ProviderModelCatalog;
}

export interface ComposeConnectionsAtBootOpts {
  db: Db;
  secretStore: SecretStore;
  pendingFlowStore: TtlStore<PendingFlow>;
  secretRequestStores: SecretRequestStores;
  operatorCredentials?: OperatorCredentials;
  shareBaseUrl?: string;
  curveBenderDeployment?: boolean;
  damBaseUrl?: string;
  brandName?: string;
  damSkill?: readonly DamSkillFile[];
  e2eEnabled?: boolean;
}

export function composeConnectionsAtBoot(
  opts: ComposeConnectionsAtBootOpts,
): ConnectionsBootCompose {
  const templates = createConnectionTemplateRegistry(
    buildCatalog(opts.operatorCredentials, {
      ...(opts.shareBaseUrl ? { shareBaseUrl: opts.shareBaseUrl } : {}),
      ...(opts.damBaseUrl ? { damBaseUrl: opts.damBaseUrl } : {}),
      ...(opts.brandName ? { brandName: opts.brandName } : {}),
      ...(opts.damSkill ? { damSkill: opts.damSkill } : {}),
      curveBenderDeployment: opts.curveBenderDeployment ?? false,
    }),
  );

  const oauthEngine = createOAuthEngine({
    pendingStore: opts.pendingFlowStore,
  });
  const githubAppEngine = createGitHubAppEngine();
  const s3CredentialProbe = opts.e2eEnabled
    ? createAcceptingS3CredentialProbe()
    : createS3CredentialProbe();
  const providerKeyProbe = opts.e2eEnabled
    ? createAcceptingProviderKeyProbe()
    : createProviderKeyProbe();
  const refreshLoop = createOAuthRefreshLoop({
    db: opts.db,
    engine: oauthEngine,
    githubAppEngine,
    templates,
    secretStore: opts.secretStore,
    connectionLock: createXactLock(opts.db),
  });

  const accountLabelBackfill = createAccountLabelBackfill({
    db: opts.db,
    templates,
    secretStore: opts.secretStore,
  });

  return {
    templates,
    secretRequestStores: opts.secretRequestStores,
    oauthEngine,
    githubAppEngine,
    s3CredentialProbe,
    providerKeyProbe,
    mcpToolLister: createMcpToolLister(),
    refreshLoop,
    accountLabelBackfill,
    providerModelCatalog: createProviderModelCatalog({
      secretStore: opts.secretStore,
      shipped: loadShippedHarnessFacts({
        log: (m) => getLogger().warn(m),
      }),
    }),
  };
}

export function createConnectionGrantsCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const repo = createConnectionsRepository(db);
  return (agentId) => repo.revokeAllForAgent(agentId);
}

export function listConnectionGrantAgentIds(db: Db): Promise<string[]> {
  return createConnectionsRepository(db).listDistinctGrantAgentIds();
}

export async function listManagedConnectionOwners(db: Db): Promise<string[]> {
  const repo = createConnectionsRepository(db);
  const owners = await Promise.all(
    [CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID, ...REMOVED_PROVIDER_TEMPLATE_IDS].map(
      (templateId) => repo.listOwnersOfTemplate(templateId),
    ),
  );
  return [...new Set(owners.flat())];
}

export function listConnectionTemplateIds(db: Db): () => Promise<string[]> {
  return () => readConnectionTemplateIds(db);
}

export function createGrantedConnectionTemplates(db: Db): {
  templateOf(agentId: string, connectionId: string): Promise<string | null>;
  ownedTemplateOf(
    ownerSub: string,
    connectionId: string,
  ): Promise<string | null>;
  grantedTo(
    agentId: string,
  ): Promise<readonly { connectionId: string; templateId: string }[]>;
} {
  const repo = createConnectionsRepository(db);
  return {
    async templateOf(agentId, connectionId) {
      const granted = await repo.listConnectionsForAgent(agentId);
      return granted.find((c) => c.id === connectionId)?.templateId ?? null;
    },
    async ownedTemplateOf(ownerSub, connectionId) {
      const owned = await repo.get(connectionId, ownerSub);
      const pending =
        owned?.auth.kind === "oauth" &&
        !owned.auth.connectedAt &&
        !owned.auth.expiresAt;
      return owned && !pending ? owned.templateId : null;
    },
    async grantedTo(agentId) {
      const granted = await repo.listConnectionsForAgent(agentId);
      return granted.map((c) => ({
        connectionId: c.id,
        templateId: c.templateId,
      }));
    },
  };
}

interface PricedConnection {
  readonly connectionId: string;
  readonly provider: string;
  readonly env: Readonly<Record<string, string>>;
  credential(): Promise<string | null>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Connections of one provider template with
 * their env and a way to read their key, for the spend module's price
 * reader. The key is read from the secret store only when a read asks for
 * it, and only a key-header Connection has one.
 */
export function createPricedConnections(deps: {
  db: Db;
  secretStore: SecretStore;
}): {
  list(provider: string): Promise<PricedConnection[]>;
  one(connectionId: string): Promise<PricedConnection | null>;
} {
  const repo = createConnectionsRepository(deps.db);
  const priced = (connection: Connection): PricedConnection => ({
    connectionId: connection.id,
    provider: connection.templateId,
    env: connectionEnv(connection),
    credential: async () =>
      connection.auth.kind === "header"
        ? deps.secretStore.getField(connection.auth.valueRef)
        : null,
  });
  return {
    async list(provider) {
      return (await listConnectionsByTemplate(deps.db, provider)).map(priced);
    },
    async one(connectionId) {
      const connection = await repo.getById(connectionId);
      return connection ? priced(connection) : null;
    },
  };
}

export function createProviderEgressScopes(db: Db): {
  covers(agentId: string, request: ProviderEgressRequest): Promise<boolean>;
} {
  const repo = createConnectionsRepository(db);
  return {
    async covers(agentId, request) {
      const granted = await repo.listConnectionsForAgent(agentId);
      return providerEgressScopes(granted).some((scope) =>
        scopeCovers(scope, request),
      );
    },
  };
}

// UNIT_BOUNDARY_DESCRIPTION: answers the egress gate which grant limits the tool calls of a request of an Agent to a host, and the rule of each tool. Any MCP Connection with a Secret can limit its own MCP host, so it reads the Agent's granted Connections with each grant's tool access once for each request, with no cache, and the owner's change holds from the next request. The one read answers every host the check looks up, and whether the Agent holds a limiting grant on any host, for a request whose real host the gateway did not say.
export function createToolAccessConnections(
  db: Db,
  templates: Pick<ConnectionTemplateRegistry, "get">,
): {
  forAgent(agentId: string): Promise<{
    limiting(request: {
      host: string;
      connectionId: string | null;
    }): ToolAccessLimit | null;
    held(): LimitingConnection | null;
  }>;
} {
  const repo = createConnectionsRepository(db);
  const templateOf = (templateId: string) => templates.get(templateId);
  return {
    async forAgent(agentId) {
      const granted = await repo.listGrantedConnections(agentId);
      return {
        limiting: (request) => toolAccessFor(granted, templateOf, request),
        held: () => heldToolAccess(granted, templateOf),
      };
    },
  };
}

export function createToolCallLabels(deps: {
  db: Db;
  secretStore: SecretStore;
}): ToolCallLabels {
  return createToolCallLabelsService({
    repo: createConnectionsRepository(deps.db),
    secretStore: deps.secretStore,
  });
}

// UNIT_BOUNDARY_DESCRIPTION: answers the login whether an Agent is on the Platform Access scale and may read itself: its grant of the platform Connection stores an access that says so. It reads the grant on every call, with no cache, so the owner's change holds from the Agent's next request.
export function createPlatformAccessReader(db: Db): {
  readsItself(agentId: string): Promise<boolean>;
} {
  const repo = createConnectionsRepository(db);
  return {
    async readsItself(agentId) {
      return readsItself(
        await repo.findPlatformAccess(agentId, DAM_TEMPLATE_ID),
      );
    },
  };
}

export function createConnectionNames(db: Db): {
  namesOf(ownerSub: string): Promise<ReadonlyMap<string, string>>;
} {
  const repo = createConnectionsRepository(db);
  return {
    async namesOf(ownerSub) {
      return new Map(
        (await repo.listByOwner(ownerSub)).map((c) => [c.id, c.name]),
      );
    },
  };
}

export function composeConnectionsForOwner(opts: {
  ownerId: string;
  db: Db;
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  oauthEngine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  s3CredentialProbe: S3CredentialProbe;
  providerKeyProbe: ProviderKeyProbe;
  secretStore: SecretStore;
  runtimeMutator: RuntimeMutator;
  agentsRepo: AgentsRepository;
  connectionRulesSync: ConnectionRulesSync;
  oauthCallbackUrl: string;
  brandName: string;
  maxSharedKbConnections?: number;
  damKey: DamKeyPort;
  damConnectionOffered: () => Promise<boolean>;
  toolApprovalOffered: () => Promise<boolean>;
  mcpToolLister: McpToolLister;
  curveBenderDeploymentKey: string | null;
  harnesses: Pick<HarnessCatalog, "default" | "harnesses">;
  providerModelCatalog: ProviderModelCatalog;
  newAgentProvider?: () => Promise<{
    connectionId: string;
    harness: string;
  } | null>;
  mirroredChildren?: (agentId: string) => Promise<string[]>;
  parentOf: (agentId: string) => Promise<string | null>;
}): ConnectionsService & ManagedProviderConnections {
  const repo = createConnectionsRepository(opts.db);
  const connectionLock = createXactLock(opts.db);

  const port: FanOutPort = {
    async setConnectionGrants(agentId, connectionIds): Promise<void> {
      await opts.agentsRepo.patchSpec(agentId, {
        grantedConnectionIds: connectionIds,
      });
    },
    async syncEgressHosts(input): Promise<void> {
      await opts.connectionRulesSync.syncForAgent(input);
    },
  };

  const fanOut = createContributionFanOut({
    port,
    runtimeMutator: opts.runtimeMutator,
  });

  const oauthFlow = createOAuthFlowService({
    engine: opts.oauthEngine,
    githubAppEngine: opts.githubAppEngine,
    repo,
    templates: opts.templates,
    secretStore: opts.secretStore,
    runtimeMutator: opts.runtimeMutator,
    ownerId: opts.ownerId,
    callbackUrl: opts.oauthCallbackUrl,
    connectionLock,
    mcpToolLister: opts.mcpToolLister,
  });

  return createConnectionsService({
    ownerId: opts.ownerId,
    ...(opts.mirroredChildren
      ? { mirroredChildren: opts.mirroredChildren }
      : {}),
    parentOf: opts.parentOf,
    templates: opts.templates,
    repo,
    secretStore: opts.secretStore,
    fanOut,
    oauthFlow,
    oauthEngine: opts.oauthEngine,
    githubAppEngine: opts.githubAppEngine,
    s3CredentialProbe: opts.s3CredentialProbe,
    providerBalance: createProviderBalanceSource(),
    providerKeyProbe: opts.providerKeyProbe,
    credentialProbe: createCredentialProbe(),
    oauthCallbackUrl: opts.oauthCallbackUrl,
    brandName: opts.brandName,
    damKey: opts.damKey,
    damConnectionOffered: opts.damConnectionOffered,
    toolApprovalOffered: opts.toolApprovalOffered,
    mcpToolLister: opts.mcpToolLister,
    connectionLock,
    isOwnedAgent: (agentId) => opts.agentsRepo.isOwnedBy(agentId, opts.ownerId),
    resolveKbShare: createKbShareResolver(opts.db),
    curveBenderDeploymentKey: opts.curveBenderDeploymentKey,
    harnesses: opts.harnesses,
    providerModelCatalog: opts.providerModelCatalog,
    newAgentProvider: opts.newAgentProvider,
    ...(opts.maxSharedKbConnections !== undefined
      ? { maxSharedKbConnections: opts.maxSharedKbConnections }
      : {}),
  });
}

export function composeSecretRequestsForOwner(opts: {
  ownerId: string;
  db: Db;
  uiBaseUrl: string;
  stores: SecretRequestStores;
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  connections: Pick<
    ConnectionsService,
    "createFromTemplate" | "update" | "getConnection" | "updateAgentConnections"
  >;
  agentName: (agentId: string) => Promise<string | null>;
}): SecretRequestsService {
  return createSecretRequestsService({
    ownerId: opts.ownerId,
    uiBaseUrl: opts.uiBaseUrl,
    pending: opts.stores.pending,
    outcomes: opts.stores.outcomes,
    templates: opts.templates,
    repo: createConnectionsRepository(opts.db),
    connections: opts.connections,
    agentName: opts.agentName,
  });
}

export function composeAgentSecretRequests(opts: {
  ownerId: string;
  agentId: string;
  db: Db;
  uiBaseUrl: string;
  stores: SecretRequestStores;
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
}): AgentSecretRequests {
  return createAgentSecretRequests({
    ownerId: opts.ownerId,
    agentId: opts.agentId,
    uiBaseUrl: opts.uiBaseUrl,
    pending: opts.stores.pending,
    outcomes: opts.stores.outcomes,
    templates: opts.templates,
    repo: createConnectionsRepository(opts.db),
  });
}
