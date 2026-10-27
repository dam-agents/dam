import {
  type ConnectionView,
  type DefaultKind,
  harnessCatalogOf,
  type HarnessConfigStatus,
  type ProfileWithUsage,
  type SessionDefaults,
  type SessionPair,
} from "api-server-api";
import type { HarnessCatalogView } from "agent-runtime-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../domain/errors.js";
import {
  modelProviders,
  type AgentModelsView,
} from "../domain/agent-models.js";

type ModelsResult<T> = Result<T, TransportError | AuthRequiredError>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the agent's Providers page reads and
 * changes, as the CLI reaches it: the provider Connections granted to the
 * agent, the harnesses its runtime carries, its saved Session Pair defaults
 * (chat, channel, scheduled) and the models its providers list for a
 * harness. Each call is one api-server procedure, so the
 * server keeps every rule about which pair is valid.
 */
export interface AgentModelsService {
  grantedConnectionIds(agentId: string): Promise<ModelsResult<string[]>>;
  connections(): Promise<ModelsResult<readonly ConnectionView[]>>;
  status(agentId: string): Promise<ModelsResult<HarnessConfigStatus>>;
  savedDefaults(agentId: string): Promise<ModelsResult<SessionDefaults>>;
  updateProviders(
    agentId: string,
    change: { grant: string[]; revoke: string[] },
  ): Promise<ModelsResult<void>>;
  rememberDefault(
    agentId: string,
    kind: DefaultKind,
    pair: SessionPair,
    references?: { profileId?: string | null },
  ): Promise<ModelsResult<void>>;
  profiles(): Promise<ModelsResult<readonly ProfileWithUsage[]>>;
  clearDefault(
    agentId: string,
    kind: Exclude<DefaultKind, "chat">,
  ): Promise<ModelsResult<void>>;
  catalog(
    agentId: string,
    harness: string,
  ): Promise<ModelsResult<HarnessCatalogView>>;
}

export function createAgentModelsService(deps: {
  trpc: TrpcClient;
}): AgentModelsService {
  return {
    grantedConnectionIds: (agentId) =>
      trpcCall(async () =>
        (
          await deps.trpc.connections.getAgentConnections.query({ agentId })
        ).connections.map((c) => c.connectionId),
      ),
    connections: () => trpcCall(() => deps.trpc.connections.list.query()),
    status: (agentId) =>
      trpcCall(() => deps.trpc.harnessConfig.status.query({ agentId })),
    savedDefaults: (agentId) =>
      trpcCall(() =>
        deps.trpc.harnessConfig.sessionDefaults.query({ agentId }),
      ),
    updateProviders: (agentId, change) =>
      trpcCall(async () => {
        await deps.trpc.connections.updateAgentConnections.mutate({
          agentId,
          ...change,
        });
      }),
    rememberDefault: (agentId, kind, pair, references) =>
      trpcCall(async () => {
        await deps.trpc.harnessConfig.rememberSessionPair.mutate({
          agentId,
          kind,
          ...pair,
          ...(references !== undefined && { profileId: references.profileId }),
        });
      }),
    profiles: () => trpcCall(() => deps.trpc.profiles.list.query()),
    clearDefault: (agentId, kind) =>
      trpcCall(async () => {
        await deps.trpc.harnessConfig.clearSessionDefault.mutate({
          agentId,
          kind,
        });
      }),
    catalog: (agentId, harness) =>
      trpcCall(async () =>
        harnessCatalogOf(
          await deps.trpc.connections.agentCatalog.query({ agentId }),
          harness,
        ),
      ),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a part that cannot be read, such as the
 * providers for an API key without credentials:read, is null with its
 * reason under `unreadable`, so the rest of the view still shows and a
 * failed read never looks like a default that is not set.
 */
export async function readAgentModels(
  svc: AgentModelsService,
  agentId: string,
): Promise<AgentModelsView> {
  const [granted, connections, status, defaults] = await Promise.all([
    svc.grantedConnectionIds(agentId),
    svc.connections(),
    svc.status(agentId),
    svc.savedDefaults(agentId),
  ]);
  const providersFailed = !granted.ok
    ? granted.error
    : !connections.ok
      ? connections.error
      : null;
  return {
    providers:
      granted.ok && connections.ok
        ? modelProviders(connections.value, granted.value)
        : null,
    harnesses: status.ok
      ? (status.value.harnesses?.map((h) => h.name) ?? null)
      : null,
    defaultHarness: status.ok ? status.value.defaultHarness : null,
    defaults: defaults.ok ? defaults.value : null,
    unreadable: {
      ...(providersFailed && { providers: providersFailed.reason }),
      ...(!status.ok && { harnesses: status.error.reason }),
      ...(!defaults.ok && { defaults: defaults.error.reason }),
    },
  };
}
