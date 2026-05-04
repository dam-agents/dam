import { createForksService, type ForksService } from "./services/forks-service.js";
import type { ForkOrchestratorPort } from "./infrastructure/ports.js";

export function composeForksModule(deps: {
  orchestrator: ForkOrchestratorPort;
}): { forks: ForksService } {
  return { forks: createForksService(deps) };
}
