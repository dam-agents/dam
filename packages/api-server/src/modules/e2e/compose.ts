import type { E2eService } from "api-server-api";
import {
  createE2eService,
  type SlackE2eControl,
} from "./services/e2e-service.js";

export function composeE2eModule(deps: {
  namespace: string;
  slack?: SlackE2eControl;
}): {
  service: E2eService;
} {
  return { service: createE2eService(deps) };
}
