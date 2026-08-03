import type { MetricsOverview, MetricsQuery } from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

export interface MetricsService {
  overview(
    query: MetricsQuery,
  ): Promise<Result<MetricsOverview, TransportError | AuthRequiredError>>;
}

export function createMetricsService(deps: {
  trpc: TrpcClient;
}): MetricsService {
  return {
    async overview(query) {
      return trpcCall(() => deps.trpc.metrics.overview.query(query));
    },
  };
}
