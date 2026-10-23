import { err, ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  NotFoundError,
  RuntimeMigratingError,
  TransportError,
} from "../domain/errors.js";
import type { AgentView } from "../domain/agent-view.js";
import {
  classifyTrpcError,
  trpcCall,
  trpcErrorCode,
} from "../../shared/trpc/classify.js";
import type { AgentUpdateInput, RuntimeFleet } from "api-server-api";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface AgentService {
  list(): Promise<
    Result<readonly AgentView[], TransportError | AuthRequiredError>
  >;
  runtimeFleet(): Promise<
    Result<RuntimeFleet, TransportError | AuthRequiredError>
  >;
  get(
    id: string,
  ): Promise<Result<AgentView | null, TransportError | AuthRequiredError>>;
  deleteAgent(
    agentId: string,
  ): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  restart(
    id: string,
  ): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  setDisabled(
    id: string,
    disabled: boolean,
  ): Promise<
    Result<
      AgentView,
      TransportError | AuthRequiredError | NotFoundError | RuntimeMigratingError
    >
  >;
  updateIdentity(
    input: Pick<AgentUpdateInput, "id" | "name" | "avatar">,
  ): Promise<
    Result<AgentView, TransportError | AuthRequiredError | NotFoundError>
  >;
  unlockedCharacters(): Promise<
    Result<readonly string[], TransportError | AuthRequiredError>
  >;
  customAvatarsEnabled(): Promise<
    Result<boolean, TransportError | AuthRequiredError>
  >;
}

export function createAgentService(deps: { trpc: TrpcClient }): AgentService {
  function notFoundOnMutate(
    e: unknown,
    ref: string,
  ): Result<never, TransportError | AuthRequiredError | NotFoundError> {
    if (trpcErrorCode(e) === "NOT_FOUND")
      return err({ kind: "not-found", ref, via: "id" });
    return classifyTrpcError(e);
  }

  return {
    async list() {
      return trpcCall(() => deps.trpc.agents.list.query());
    },
    async runtimeFleet() {
      return trpcCall(() => deps.trpc.agents.runtimeFleet.query());
    },
    async get(id) {
      try {
        return ok(await deps.trpc.agents.get.query({ id }));
      } catch (e) {
        if (trpcErrorCode(e) === "NOT_FOUND") return ok(null);
        return classifyTrpcError(e);
      }
    },
    async deleteAgent(agentId) {
      try {
        await deps.trpc.agents.delete.mutate({ id: agentId });
        return ok(undefined);
      } catch (e) {
        return notFoundOnMutate(e, agentId);
      }
    },
    async restart(id) {
      try {
        await deps.trpc.agents.restart.mutate({ id });
        return ok(undefined);
      } catch (e) {
        return notFoundOnMutate(e, id);
      }
    },
    async setDisabled(id, disabled) {
      try {
        return ok(await deps.trpc.agents.setDisabled.mutate({ id, disabled }));
      } catch (e) {
        if (trpcErrorCode(e) === "CONFLICT")
          return err({ kind: "runtime-migrating" });
        return notFoundOnMutate(e, id);
      }
    },
    async updateIdentity(input) {
      try {
        return ok(await deps.trpc.agents.update.mutate(input));
      } catch (e) {
        return notFoundOnMutate(e, input.id);
      }
    },
    async unlockedCharacters() {
      return trpcCall(async () =>
        (await deps.trpc.gettingStarted.progress.query()).unlocks.map(
          (u) => u.character,
        ),
      );
    },
    async customAvatarsEnabled() {
      return trpcCall(
        async () => (await deps.trpc.features.flags.query())["custom-avatars"],
      );
    },
  };
}
