import type {
  ClusterCaProbe,
  ConnectionCreateInput,
  ConnectionTemplateView,
  ConnectionView,
} from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../domain/errors.js";

type ConnResult<T> = Result<T, TransportError | AuthRequiredError>;

export interface ConnectionService {
  list(): Promise<
    Result<readonly ConnectionView[], TransportError | AuthRequiredError>
  >;
  listTemplates(): Promise<ConnResult<readonly ConnectionTemplateView[]>>;
  createConnection(
    input: ConnectionCreateInput,
  ): Promise<ConnResult<{ id: string }>>;
  update(id: string, value: string): Promise<ConnResult<void>>;
  startOAuth(connectionId: string): Promise<ConnResult<{ authUrl: string }>>;
  discoverMcp(url: string): Promise<ConnResult<{ auth: "oauth" | "none" }>>;
  probeClusterCa(host: string): Promise<ConnResult<ClusterCaProbe>>;
  getConnection(id: string): Promise<ConnResult<ConnectionView | null>>;
  agentConnectionIds(
    agentId: string,
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
  grant(
    agentId: string,
    add: readonly string[],
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
  revoke(
    agentId: string,
    remove: readonly string[],
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
  disconnect(
    id: string,
  ): Promise<Result<void, TransportError | AuthRequiredError>>;
}

export function createConnectionService(deps: {
  trpc: TrpcClient;
}): ConnectionService {
  const readIds = async (agentId: string): Promise<readonly string[]> => {
    const res = await deps.trpc.connections.getAgentConnections.query({
      agentId,
    });
    return res.connections.map((c) => c.connectionId);
  };

  return {
    async list() {
      return trpcCall(() => deps.trpc.connections.list.query());
    },
    async listTemplates() {
      return trpcCall(() => deps.trpc.connections.listTemplates.query());
    },
    async createConnection(input) {
      return trpcCall(() => deps.trpc.connections.create.mutate(input));
    },
    async update(id, value) {
      return trpcCall(async () => {
        await deps.trpc.connections.update.mutate({ id, value });
      });
    },
    async startOAuth(connectionId) {
      return trpcCall(() =>
        deps.trpc.connections.startOAuth.mutate({ connectionId }),
      );
    },
    async discoverMcp(url) {
      return trpcCall(() => deps.trpc.connections.discoverMcp.mutate({ url }));
    },
    async probeClusterCa(host) {
      return trpcCall(() =>
        deps.trpc.connections.probeClusterCa.mutate({ host }),
      );
    },
    async getConnection(id) {
      return trpcCall(() => deps.trpc.connections.get.query({ id }));
    },
    async agentConnectionIds(agentId) {
      return trpcCall(() => readIds(agentId));
    },
    async grant(agentId, add) {
      return trpcCall(async () => {
        const current = await readIds(agentId);
        const next = Array.from(new Set([...current, ...add]));
        await deps.trpc.connections.setAgentConnections.mutate({
          agentId,
          connectionIds: next,
        });
        return next as readonly string[];
      });
    },
    async revoke(agentId, remove) {
      return trpcCall(async () => {
        const drop = new Set(remove);
        const current = await readIds(agentId);
        const next = current.filter((id) => !drop.has(id));
        await deps.trpc.connections.setAgentConnections.mutate({
          agentId,
          connectionIds: next,
        });
        return next as readonly string[];
      });
    },
    async disconnect(id) {
      return trpcCall(async () => {
        await deps.trpc.connections.delete.mutate({ id });
      });
    },
  };
}
