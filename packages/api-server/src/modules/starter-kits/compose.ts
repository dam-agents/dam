import type { StarterKitsService } from "api-server-api";
import {
  createStarterKitsService,
  type StarterKitsServiceDeps,
} from "./services/starter-kits-service.js";

export function composeStarterKitsForOwner(opts: StarterKitsServiceDeps): {
  starterKits: StarterKitsService;
} {
  return { starterKits: createStarterKitsService(opts) };
}
