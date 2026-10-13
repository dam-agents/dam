import type { SpendDailyInput, SpendDailyRow } from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

export interface SpendService {
  daily(
    input: SpendDailyInput,
  ): Promise<Result<SpendDailyRow[], TransportError | AuthRequiredError>>;
}

export function createSpendService(deps: { trpc: TrpcClient }): SpendService {
  return {
    async daily(input) {
      return trpcCall(() => deps.trpc.spend.daily.query(input));
    },
  };
}
