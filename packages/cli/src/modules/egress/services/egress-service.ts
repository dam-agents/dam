import type {
  EgressPreset,
  EgressRuleCreateInput,
  EgressRuleUpdateInput,
  EgressRuleView,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AuthRequiredError,
  RuleNotFoundError,
  TransportError,
} from "../domain/errors.js";

export interface EgressService {
  listForAgent(
    agentId: string,
  ): Promise<
    Result<readonly EgressRuleView[], TransportError | AuthRequiredError>
  >;
  currentPreset(
    agentId: string,
  ): Promise<Result<EgressPreset, TransportError | AuthRequiredError>>;
  trustedHosts(): Promise<
    Result<readonly string[], TransportError | AuthRequiredError>
  >;
  create(
    input: EgressRuleCreateInput,
  ): Promise<Result<EgressRuleView, TransportError | AuthRequiredError>>;
  update(
    input: EgressRuleUpdateInput,
  ): Promise<
    Result<
      EgressRuleView,
      TransportError | AuthRequiredError | RuleNotFoundError
    >
  >;
  revoke(id: string): Promise<Result<void, TransportError | AuthRequiredError>>;
  applyPreset(
    agentId: string,
    preset: EgressPreset,
  ): Promise<Result<void, TransportError | AuthRequiredError>>;
}

export function createEgressService(deps: { trpc: TrpcClient }): EgressService {
  return {
    async listForAgent(agentId) {
      return trpcCall(
        () =>
          deps.trpc.egressRules.listForAgent.query({ agentId }) as Promise<
            readonly EgressRuleView[]
          >,
      );
    },
    async currentPreset(agentId) {
      return trpcCall(
        () =>
          deps.trpc.egressRules.currentPreset.query({
            agentId,
          }) as Promise<EgressPreset>,
      );
    },
    async trustedHosts() {
      return trpcCall(
        () =>
          deps.trpc.egressRules.trustedHosts.query() as Promise<
            readonly string[]
          >,
      );
    },
    async create(input) {
      return trpcCall(
        () =>
          deps.trpc.egressRules.create.mutate(input) as Promise<EgressRuleView>,
      );
    },
    async update(input) {
      try {
        const view = (await deps.trpc.egressRules.update.mutate(
          input,
        )) as EgressRuleView;
        return ok(view);
      } catch (e) {
        if ((e as { data?: { code?: string } })?.data?.code === "NOT_FOUND") {
          return err({ kind: "rule-not-found", id: input.id });
        }
        return classifyTrpcError(e);
      }
    },
    async revoke(id) {
      // Server is idempotent on revoke — unknown IDs return without throwing.
      return trpcCall(async () => {
        await deps.trpc.egressRules.revoke.mutate({ id });
      });
    },
    async applyPreset(agentId, preset) {
      return trpcCall(async () => {
        await deps.trpc.egressRules.applyPreset.mutate({ agentId, preset });
      });
    },
  };
}
