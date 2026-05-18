import type {
  SessionResolution,
  SessionView,
  TerminalStrategy,
} from "api-server-api";
import { ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../../instance/domain/errors.js";
import { classifyTrpcError } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface SessionsPort {
  list(
    instanceId: string,
  ): Promise<
    Result<readonly SessionView[], TransportError | AuthRequiredError>
  >;
  resolveTerminal(
    instanceId: string,
    strategy: TerminalStrategy,
    opts?: { reset?: boolean; force?: boolean },
  ): Promise<Result<SessionResolution, TransportError | AuthRequiredError>>;
}

export function createSessionsPort(deps: { trpc: TrpcClient }): SessionsPort {
  return {
    async list(instanceId) {
      try {
        return ok(
          (await deps.trpc.sessions.list.query({
            instanceId,
          })) as readonly SessionView[],
        );
      } catch (e) {
        return classifyTrpcError(e);
      }
    },
    async resolveTerminal(instanceId, strategy, opts) {
      try {
        return ok(
          (await deps.trpc.sessions.resolveTerminal.mutate({
            instanceId,
            strategy,
            reset: opts?.reset,
            force: opts?.force,
          })) as SessionResolution,
        );
      } catch (e) {
        return classifyTrpcError(e);
      }
    },
  };
}
