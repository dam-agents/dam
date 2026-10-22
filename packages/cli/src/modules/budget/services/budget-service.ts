import type {
  UserBudgetEntry,
  UserBudgetPage,
  UserBudgetRemoveInput,
  UserBudgetSetInput,
  UserBudgetsListInput,
} from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

type BudgetResult<T> = Promise<Result<T, TransportError | AuthRequiredError>>;

export interface BudgetService {
  list(input: UserBudgetsListInput): BudgetResult<UserBudgetPage>;
  set(input: UserBudgetSetInput): BudgetResult<UserBudgetEntry | null>;
  remove(input: UserBudgetRemoveInput): BudgetResult<{ removed: boolean }>;
}

export function createBudgetService(deps: { trpc: TrpcClient }): BudgetService {
  return {
    async list(input) {
      return trpcCall(() => deps.trpc.budgets.users.list.query(input));
    },
    async set(input) {
      return trpcCall(() => deps.trpc.budgets.users.set.mutate(input));
    },
    async remove(input) {
      return trpcCall(() => deps.trpc.budgets.users.remove.mutate(input));
    },
  };
}
