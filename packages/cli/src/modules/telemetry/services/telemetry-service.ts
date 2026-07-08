import type { TelemetryOverview, TelemetryQuery } from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

export interface TelemetryService {
  overview(
    query: TelemetryQuery,
  ): Promise<Result<TelemetryOverview, TransportError | AuthRequiredError>>;
}

export function createTelemetryService(deps: {
  trpc: TrpcClient;
}): TelemetryService {
  return {
    async overview(query) {
      return trpcCall(() => deps.trpc.telemetry.overview.query(query));
    },
  };
}
