import type {
  ConnectionView,
  DefaultKind,
  HarnessConfigStatus,
  SessionDefaults,
  SessionPair,
} from "api-server-api";
import type { HarnessCatalogView } from "agent-runtime-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type {
  AgentTrpcClient,
  TrpcClient,
} from "../../shared/trpc/trpc-client.js";
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
 * harness. Each call is one api-server or agent-runtime procedure, so the
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
  ): Promise<ModelsResult<void>>;
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
  agentTrpc: (agentId: string) => AgentTrpcClient;
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
    rememberDefault: (agentId, kind, pair) =>
      trpcCall(async () => {
        await deps.trpc.harnessConfig.rememberSessionPair.mutate({
          agentId,
          kind,
          ...pair,
        });
      }),
    clearDefault: (agentId, kind) =>
      trpcCall(async () => {
        await deps.trpc.harnessConfig.clearSessionDefault.mutate({
          agentId,
          kind,
        });
      }),
    catalog: (agentId, harness) =>
      trpcCall(() =>
        deps.agentTrpc(agentId).harnessConfig.catalog.query({ harness }),
      ),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a part the caller may not read, such as the
 * providers for a token without credentials:read, is null, so the rest of
 * the view still shows.
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
  return {
    providers:
      granted.ok && connections.ok
        ? modelProviders(connections.value, granted.value)
        : null,
    harnesses: status.ok
      ? (status.value.harnesses?.map((h) => h.name) ?? null)
      : null,
    defaultHarness: status.ok ? status.value.defaultHarness : null,
    defaults: defaults.ok
      ? defaults.value
      : { chat: null, channel: null, scheduled: null },
  };
}
