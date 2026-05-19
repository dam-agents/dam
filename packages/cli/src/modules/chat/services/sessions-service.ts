import type {
  SessionResolution,
  SessionView,
  TerminalStrategy,
} from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
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
      return trpcCall(
        () =>
          deps.trpc.sessions.list.query({ instanceId }) as Promise<
            readonly SessionView[]
          >,
      );
    },
    async resolveTerminal(instanceId, strategy, opts) {
      return trpcCall(
        () =>
          deps.trpc.sessions.resolveTerminal.mutate({
            instanceId,
            strategy,
            reset: opts?.reset,
            force: opts?.force,
          }) as Promise<SessionResolution>,
      );
    },
  };
}
