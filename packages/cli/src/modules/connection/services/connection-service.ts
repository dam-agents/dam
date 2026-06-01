import type { ConnectionView } from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../domain/errors.js";

export interface ConnectionService {
  /** All of the owner's connections (apps + MCP), as stored on the server. */
  list(): Promise<
    Result<readonly ConnectionView[], TransportError | AuthRequiredError>
  >;
  /** Connection ids currently granted to an agent. */
  agentConnectionIds(
    agentId: string,
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
  /** Read current grants, union in `add`, write the full set back. Returns the resulting set. */
  grant(
    agentId: string,
    add: readonly string[],
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
  /** Read current grants, remove `remove`, write the full set back. Returns the resulting set. Idempotent. */
  revoke(
    agentId: string,
    remove: readonly string[],
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
  /** Delete a connection (the stored credential) by id. */
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
      return trpcCall(
        () =>
          deps.trpc.connections.list.query() as Promise<
            readonly ConnectionView[]
          >,
      );
    },
    async agentConnectionIds(agentId) {
      return trpcCall(() => readIds(agentId));
    },
    async grant(agentId, add) {
      // `setAgentConnections` is a full replace — read current grants, union
      // in the additions, and write the whole set back so the server's
      // contribution/egress resync sees the correct final state.
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
