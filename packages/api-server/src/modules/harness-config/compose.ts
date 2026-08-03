import type { HarnessConfigService } from "api-server-api";
import { createHarnessConfigService } from "./services/harness-config-service.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeHarnessConfigModule(deps: {
  runtimeMutator: RuntimeMutator;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  isSettled: (agentId: string) => Promise<boolean>;
}): { service: HarnessConfigService } {
  return {
    service: createHarnessConfigService({
      runtimeMutator: deps.runtimeMutator,
      isOwnedAgent: deps.isOwnedAgent,
      getCapabilities: deps.getCapabilities,
      isSettled: deps.isSettled,
    }),
  };
}
