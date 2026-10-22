import type {
  SpendDailyInput,
  SpendDailyRow,
  SpendSetLimitInput,
  SpendStatus,
  SpendStatusInput,
  SpendTurns,
  SpendTurnsInput,
} from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

type SpendResult<T> = Promise<Result<T, TransportError | AuthRequiredError>>;

export interface SpendService {
  daily(input: SpendDailyInput): SpendResult<SpendDailyRow[]>;
  status(input: SpendStatusInput): SpendResult<SpendStatus>;
  setLimit(input: SpendSetLimitInput): SpendResult<void>;
  turns(input: SpendTurnsInput): SpendResult<SpendTurns>;
}

export function createSpendService(deps: { trpc: TrpcClient }): SpendService {
  return {
    async daily(input) {
      return trpcCall(() => deps.trpc.spend.daily.query(input));
    },
    async status(input) {
      return trpcCall(() => deps.trpc.spend.status.query(input));
    },
    async setLimit(input) {
      return trpcCall(() => deps.trpc.spend.setLimit.mutate(input));
    },
    async turns(input) {
      return trpcCall(() => deps.trpc.spend.turns.query(input));
    },
  };
}
