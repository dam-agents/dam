import type { Instance } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, NotFoundError, TransportError } from "../domain/errors.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface InstanceService {
  list(): Promise<Result<readonly Instance[], TransportError | AuthRequiredError>>;
  get(id: string): Promise<Result<Instance | null, TransportError | AuthRequiredError>>;
  deleteAgent(agentId: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  deleteInstance(id: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  restart(id: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
}

export function createInstanceService(deps: { trpc: TrpcClient }): InstanceService {
  function notFoundOnMutate(e: unknown, ref: string): Result<never, TransportError | AuthRequiredError | NotFoundError> {
    if ((e as any)?.data?.code === "NOT_FOUND") return err({ kind: "not-found", ref, via: "id" });
    return classifyTrpcError(e);
  }

  return {
    async list() {
      return trpcCall(() => deps.trpc.instances.list.query() as Promise<readonly Instance[]>);
    },
    async get(id) {
      try { return ok(await deps.trpc.instances.get.query({ id }) as Instance); }
      catch (e) {
        if ((e as any)?.data?.code === "NOT_FOUND") return ok(null);
        return classifyTrpcError(e);
      }
    },
    async deleteAgent(agentId) {
      try { await deps.trpc.agents.delete.mutate({ id: agentId }); return ok(undefined); }
      catch (e) { return notFoundOnMutate(e, agentId); }
    },
    async deleteInstance(id) {
      try { await deps.trpc.instances.delete.mutate({ id }); return ok(undefined); }
      catch (e) { return notFoundOnMutate(e, id); }
    },
    async restart(id) {
      try { await deps.trpc.instances.restart.mutate({ id }); return ok(undefined); }
      catch (e) { return notFoundOnMutate(e, id); }
    },
  };
}
