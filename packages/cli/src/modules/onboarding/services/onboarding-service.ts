import type { AssistantFirstResultInput } from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export type FirstResult = Awaited<
  ReturnType<TrpcClient["assistants"]["recordFirstResult"]["mutate"]>
>;

export interface OnboardingService {
  recordFirstResult(
    input: AssistantFirstResultInput,
  ): Promise<Result<FirstResult | null, TransportError | AuthRequiredError>>;
}

export function createOnboardingService(deps: {
  trpc: TrpcClient;
}): OnboardingService {
  return {
    recordFirstResult: (input) =>
      trpcCall(() => deps.trpc.assistants.recordFirstResult.mutate(input)),
  };
}
