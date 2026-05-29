import type { E2eService } from "api-server-api";
import { createE2eService } from "./services/e2e-service.js";

export function composeE2eModule(deps: { namespace: string }): {
  service: E2eService;
} {
  return { service: createE2eService(deps) };
}
