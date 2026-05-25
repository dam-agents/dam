import type {
  EgressPreset,
  EgressRuleCreateInput,
  EgressRuleUpdateInput,
  EgressRuleView,
} from "api-server-api";
import { err, type Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
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
  revoke(
    id: string,
  ): Promise<
    Result<void, TransportError | AuthRequiredError | RuleNotFoundError>
  >;
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
    async create(_input) {
      return err({ kind: "transport", reason: "not implemented" });
    },
    async update(_input) {
      return err({ kind: "transport", reason: "not implemented" });
    },
    async revoke(_id) {
      return err({ kind: "transport", reason: "not implemented" });
    },
    async applyPreset(_agentId, _preset) {
      return err({ kind: "transport", reason: "not implemented" });
    },
  };
}
