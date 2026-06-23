import type { Db } from "db";
import type { ConnectionsService } from "api-server-api";
import { createConnectionsRepository } from "./infrastructure/connections-repository.js";
import {
  createOAuthEngine,
  type OAuthEngine,
} from "./infrastructure/oauth-engine.js";
import { createConnectionTemplateRegistry } from "./domain/connection-template.js";
import { buildCatalog, type OperatorCredentials } from "./domain/catalog.js";
import { createConnectionsService } from "./services/connections-service.js";
import {
  createContributionFanOut,
  type FanOutPort,
} from "./services/contribution-fanout.js";
import { createOAuthFlowService } from "./services/oauth-flow.js";
import {
  createOAuthRefreshLoop,
  type OAuthRefreshLoop,
} from "./services/oauth-refresh.js";
import type { SecretStore } from "../secret-store/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { AgentsRepository } from "../agents/infrastructure/agents-repository.js";
import type { ConnectionRulesSync } from "../egress-rules/services/connection-rules-sync.js";

export interface ConnectionsBootCompose {
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  oauthEngine: OAuthEngine;
  refreshLoop: OAuthRefreshLoop;
}

export interface ComposeConnectionsAtBootOpts {
  db: Db;
  secretStore: SecretStore;
  operatorCredentials?: OperatorCredentials;
}

export function composeConnectionsAtBoot(
  opts: ComposeConnectionsAtBootOpts,
): ConnectionsBootCompose {
  const templates = createConnectionTemplateRegistry(
    buildCatalog(opts.operatorCredentials),
  );

  const oauthEngine = createOAuthEngine();
  const refreshLoop = createOAuthRefreshLoop({
    db: opts.db,
    engine: oauthEngine,
    templates,
    secretStore: opts.secretStore,
  });

  return { templates, oauthEngine, refreshLoop };
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

export function composeConnectionsForOwner(opts: {
  ownerId: string;
  db: Db;
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  oauthEngine: OAuthEngine;
  secretStore: SecretStore;
  runtimeMutator: RuntimeMutator;
  agentsRepo: AgentsRepository;
  connectionRulesSync: ConnectionRulesSync;
  oauthCallbackUrl: string;
  brandName: string;
}): ConnectionsService {
  const repo = createConnectionsRepository(opts.db);

  const port: FanOutPort = {
    async setConnectionGrants(agentId, connectionIds): Promise<void> {
      // Connection grants live in the Agent spec.
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
    repo,
    templates: opts.templates,
    secretStore: opts.secretStore,
    runtimeMutator: opts.runtimeMutator,
    ownerId: opts.ownerId,
    callbackUrl: opts.oauthCallbackUrl,
  });

  return createConnectionsService({
    ownerId: opts.ownerId,
    templates: opts.templates,
    repo,
    secretStore: opts.secretStore,
    fanOut,
    oauthFlow,
    oauthCallbackUrl: opts.oauthCallbackUrl,
    brandName: opts.brandName,
  });
}
