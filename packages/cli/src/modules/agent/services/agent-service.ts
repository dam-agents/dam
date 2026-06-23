import { err, ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  InvalidInputError,
  NotFoundError,
  TransportError,
} from "../domain/errors.js";
import type { AgentView } from "../domain/agent-view.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface AgentService {
  list(): Promise<
    Result<readonly AgentView[], TransportError | AuthRequiredError>
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
  /** Full-replace the Agent's allowed-user list; returns the updated Agent. */
  updateAllowedUserEmails(
    id: string,
    emails: readonly string[],
  ): Promise<
    Result<
      AgentView,
      TransportError | AuthRequiredError | NotFoundError | InvalidInputError
    >
  >;
}

export function createAgentService(deps: { trpc: TrpcClient }): AgentService {
  function notFoundOnMutate(
    e: unknown,
    ref: string,
  ): Result<never, TransportError | AuthRequiredError | NotFoundError> {
    if ((e as any)?.data?.code === "NOT_FOUND")
      return err({ kind: "not-found", ref, via: "id" });
    return classifyTrpcError(e);
  }

  return {
    async list() {
      return trpcCall(() => deps.trpc.agents.list.query());
    },
    async get(id) {
      try {
        return ok(await deps.trpc.agents.get.query({ id }));
      } catch (e) {
        if ((e as any)?.data?.code === "NOT_FOUND") return ok(null);
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
    async updateAllowedUserEmails(id, emails) {
      try {
        return ok(
          await deps.trpc.agents.update.mutate({
            id,
            allowedUserEmails: [...emails],
          }),
        );
      } catch (e) {
        // An unknown email (or other rejected input) comes back as BAD_REQUEST;
        // surface its message so the command exits as invalid input, not a 500.
        if ((e as { data?: { code?: string } })?.data?.code === "BAD_REQUEST") {
          return err({
            kind: "invalid-input",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return notFoundOnMutate(e, id);
      }
    },
  };
}
