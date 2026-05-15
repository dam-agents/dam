import type { SessionMode, SessionResolution, SessionView, TerminalStrategy } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../../instance/domain/errors.js";
import {
  AuthRequiredAtTransportError,
  type TrpcClient,
} from "../../shared/trpc/trpc-client.js";

export interface SessionsPort {
  list(instanceId: string): Promise<Result<readonly SessionView[], TransportError | AuthRequiredError>>;
  create(sessionId: string, instanceId: string, mode: SessionMode): Promise<Result<void, TransportError | AuthRequiredError>>;
  setMode(sessionId: string, instanceId: string, mode: SessionMode): Promise<Result<void, TransportError | AuthRequiredError>>;
  resolveTerminal(instanceId: string, strategy: TerminalStrategy, opts?: { reset?: boolean; force?: boolean }): Promise<Result<SessionResolution, TransportError | AuthRequiredError>>;
}

export function createSessionsPort(deps: { trpc: TrpcClient }): SessionsPort {
  function classify(e: unknown): Result<never, TransportError | AuthRequiredError> {
    const sentinel = findAuthSentinel(e);
    if (sentinel) return err({ kind: "auth-required", reason: sentinel.message });
    return err({ kind: "transport", reason: errorReason(e) });
  }

  function findAuthSentinel(e: unknown): AuthRequiredAtTransportError | null {
    let cursor: unknown = e;
    let depth = 0;
    while (cursor && depth < 8) {
      if (cursor instanceof AuthRequiredAtTransportError) return cursor;
      cursor = (cursor as { cause?: unknown }).cause;
      depth++;
    }
    return null;
  }

  return {
    async list(instanceId) {
      try {
        const value = await deps.trpc.sessions.list.query({ instanceId });
        return ok(value as readonly SessionView[]);
      } catch (e) {
        return classify(e);
      }
    },

    async create(sessionId, instanceId, mode) {
      try {
        await deps.trpc.sessions.create.mutate({ sessionId, instanceId, mode });
        return ok(undefined);
      } catch (e) {
        return classify(e);
      }
    },

    async setMode(sessionId, instanceId, mode) {
      try {
        await deps.trpc.sessions.setMode.mutate({ sessionId, instanceId, mode });
        return ok(undefined);
      } catch (e) {
        return classify(e);
      }
    },

    async resolveTerminal(instanceId, strategy, opts) {
      try {
        const value = await deps.trpc.sessions.resolveTerminal.mutate({ instanceId, strategy, reset: opts?.reset, force: opts?.force });
        return ok(value as SessionResolution);
      } catch (e) {
        return classify(e);
      }
    },
  };
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown transport failure";
}
