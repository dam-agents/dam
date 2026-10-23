import type {
  MetricsOverview,
  MetricsQuery,
  SpendBreakdown,
  SpendBreakdownInput,
  SpendCalls,
  SpendCallsInput,
  SpendMetering,
  SpendSessions,
  SpendSessionsInput,
} from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

type MetricsResult<T> = Promise<Result<T, TransportError | AuthRequiredError>>;

export interface MetricsService {
  overview(query: MetricsQuery): MetricsResult<MetricsOverview>;
  breakdown(input: SpendBreakdownInput): MetricsResult<SpendBreakdown>;
  sessions(input: SpendSessionsInput): MetricsResult<SpendSessions>;
  calls(input: SpendCallsInput): MetricsResult<SpendCalls>;
  metering(): MetricsResult<SpendMetering>;
}

export function createMetricsService(deps: {
  trpc: TrpcClient;
}): MetricsService {
  return {
    async overview(query) {
      return trpcCall(() => deps.trpc.metrics.overview.query(query));
    },
    async breakdown(input) {
      return trpcCall(() => deps.trpc.spend.breakdown.query(input));
    },
    async sessions(input) {
      return trpcCall(() => deps.trpc.spend.sessions.query(input));
    },
    async calls(input) {
      return trpcCall(() => deps.trpc.spend.calls.query(input));
    },
    async metering() {
      return trpcCall(() => deps.trpc.spend.metering.query());
    },
  };
}
