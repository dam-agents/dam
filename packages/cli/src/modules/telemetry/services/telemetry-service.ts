import type { TelemetryTurnsQuery, TelemetryTurnsResult } from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

export interface TelemetryService {
  turns(
    query: TelemetryTurnsQuery,
  ): Promise<Result<TelemetryTurnsResult, TransportError | AuthRequiredError>>;
}

export function createTelemetryService(deps: {
  trpc: TrpcClient;
}): TelemetryService {
  return {
    async turns(query) {
      return trpcCall(() => deps.trpc.telemetry.turns.query(query));
    },
  };
}
