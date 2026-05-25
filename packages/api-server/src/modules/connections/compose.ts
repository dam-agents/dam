import type { Db } from "db";
import { createConnectionsRepository } from "./infrastructure/connections-repository.js";
import { createConnectionTemplateRegistry } from "./domain/connection-template.js";
import { createGitHubTemplate } from "./domain/templates/github.js";
import { createCustomMcpTemplate } from "./domain/templates/custom-mcp.js";
import { createCustomHeaderTemplate } from "./domain/templates/custom-header.js";
import {
  createConnectionsService,
  type ConnectionsServiceExt,
} from "./services/connections-service.js";
import {
  createContributionFanOut,
  type FanOutPort,
} from "./services/contribution-fanout.js";
import type { SecretStore } from "../secret-store/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { AgentsRepository } from "../agents/infrastructure/agents-repository.js";
import type { ConnectionRulesSync } from "../egress-rules/services/connection-rules-sync.js";

/**
 * Composes the Connections bounded context (ADR-051). One service per
 * authenticated request, scoped to `ownerId` (the JWT sub).
 *
 * The Template registry is process-wide and stateless — build once at
 * api-server boot and re-use.
 */
export interface ConnectionsBootCompose {
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
}

export function composeConnectionsAtBoot(opts: {
  github?: { clientId: string; scopes?: string[] };
}): ConnectionsBootCompose {
  const templates = createConnectionTemplateRegistry([
    // Premade app templates first (the UI groups them in the Apps section).
    ...(opts.github ? [createGitHubTemplate(opts.github)] : []),
    // Custom templates — always present, gated by isCustom.
    createCustomMcpTemplate(),
    createCustomHeaderTemplate(),
  ]);
  return { templates };
}

export function composeConnectionsForOwner(opts: {
  ownerId: string;
  db: Db;
  templates: ReturnType<typeof createConnectionTemplateRegistry>;
  secretStore: SecretStore;
  runtimeMutator: RuntimeMutator;
  agentsRepo: AgentsRepository;
  connectionRulesSync: ConnectionRulesSync;
}): ConnectionsServiceExt {
  const repo = createConnectionsRepository(opts.db);

  const port: FanOutPort = {
    async bumpSecretsRev(agentId): Promise<void> {
      // ADR-040 mechanism: bump an annotation the controller's reconciler
      // watches. The bump value is monotonic-ish (timestamp suffices —
      // collisions in the same millisecond just no-op the rev change).
      await opts.agentsRepo.patchAnnotation(
        agentId,
        "agent-platform.ai/secrets-rev",
        String(Date.now()),
      );
    },
    async syncEgressHosts(input): Promise<void> {
      await opts.connectionRulesSync.syncForAgent(input);
    },
  };

  const fanOut = createContributionFanOut({
    db: opts.db,
    port,
    runtimeMutator: opts.runtimeMutator,
  });

  return createConnectionsService({
    ownerId: opts.ownerId,
    templates: opts.templates,
    repo,
    secretStore: opts.secretStore,
    fanOut,
  });
}
