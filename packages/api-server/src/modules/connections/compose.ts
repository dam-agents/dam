import type { Db } from "db";
import {
  PLATFORM_LLM_TEMPLATE_ID,
  type ConnectionsService,
} from "api-server-api";
import { createXactLock } from "../../core/xact-lock.js";
import { createKbShareResolver } from "../kb-shares/index.js";
import { createConnectionsRepository } from "./infrastructure/connections-repository.js";
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
import { createAcceptingProviderKeyProbe } from "./infrastructure/accepting-provider-key-probe.js";
import type { ProviderKeyProbe } from "./domain/provider-key-probe.js";
import { createConnectionTemplateRegistry } from "./domain/connection-template.js";
import {
  buildCatalog,
  type OperatorCredentials,
  type PlatformProviderEndpoint,
} from "./domain/catalog.js";
import {
  createConnectionsService,
  type PlatformLlmConnections,
} from "./services/connections-service.js";
import {
  createContributionFanOut,
  type FanOutPort,
} from "./services/contribution-fanout.js";
import { createOAuthFlowService } from "./services/oauth-flow.js";
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

export interface ConnectionsBootCompose {
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  oauthEngine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  s3CredentialProbe: S3CredentialProbe;
  providerKeyProbe: ProviderKeyProbe;
  refreshLoop: OAuthRefreshLoop;
  accountLabelBackfill: AccountLabelBackfill;
}

export interface ComposeConnectionsAtBootOpts {
  db: Db;
  secretStore: SecretStore;
  pendingFlowStore: TtlStore<PendingFlow>;
  operatorCredentials?: OperatorCredentials;
  shareBaseUrl?: string;
  platformProvider?: PlatformProviderEndpoint | null;
  e2eEnabled?: boolean;
}

export function composeConnectionsAtBoot(
  opts: ComposeConnectionsAtBootOpts,
): ConnectionsBootCompose {
  const templates = createConnectionTemplateRegistry(
    buildCatalog(opts.operatorCredentials, {
      ...(opts.shareBaseUrl ? { shareBaseUrl: opts.shareBaseUrl } : {}),
      platformProvider: opts.platformProvider ?? null,
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
    oauthEngine,
    githubAppEngine,
    s3CredentialProbe,
    providerKeyProbe,
    refreshLoop,
    accountLabelBackfill,
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

export function listPlatformConnectionOwners(db: Db): Promise<string[]> {
  return createConnectionsRepository(db).listOwnersOfTemplate(
    PLATFORM_LLM_TEMPLATE_ID,
  );
}

export function createGrantedConnectionTemplates(db: Db): {
  templateOf(agentId: string, connectionId: string): Promise<string | null>;
} {
  const repo = createConnectionsRepository(db);
  return {
    async templateOf(agentId, connectionId) {
      const granted = await repo.listConnectionsForAgent(agentId);
      return granted.find((c) => c.id === connectionId)?.templateId ?? null;
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
  platformProviderEnabled: () => Promise<boolean>;
}): ConnectionsService & PlatformLlmConnections {
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
  });

  return createConnectionsService({
    ownerId: opts.ownerId,
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
    oauthCallbackUrl: opts.oauthCallbackUrl,
    brandName: opts.brandName,
    connectionLock,
    isOwnedAgent: (agentId) => opts.agentsRepo.isOwnedBy(agentId, opts.ownerId),
    resolveKbShare: createKbShareResolver(opts.db),
    platformProviderEnabled: opts.platformProviderEnabled,
    ...(opts.maxSharedKbConnections !== undefined
      ? { maxSharedKbConnections: opts.maxSharedKbConnections }
      : {}),
  });
}
