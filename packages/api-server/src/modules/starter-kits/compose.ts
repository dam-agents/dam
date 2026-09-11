import type { StarterKitsService } from "api-server-api";
import type { StarterKitsRepository } from "./infrastructure/kits-repository.js";
import {
  createStarterKitsService,
  type StarterKitsServiceDeps,
} from "./services/starter-kits-service.js";

export function composeStarterKitsForOwner(
  opts: StarterKitsServiceDeps & { repo: StarterKitsRepository },
): { starterKits: StarterKitsService } {
  return { starterKits: createStarterKitsService(opts) };
}
