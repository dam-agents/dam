import type { Db } from "db";
import { getLogger } from "../../core/logger.js";
import { createAccessListRepository } from "./infrastructure/access-list-repository.js";
import { createAccessListAdmin } from "./services/access-list-service.js";

export function composeAccessListModule(deps: {
  db: Db;
  enabled: boolean;
  seed: readonly string[];
}) {
  const repo = createAccessListRepository(deps.db);
  return {
    forOperator: createAccessListAdmin({ repo, enabled: deps.enabled }),
    allows: (email: string) => repo.has(email.trim().toLowerCase()),
    async applySeed() {
      const added = await repo.add(deps.seed, null);
      if (added > 0)
        getLogger().info(
          { added, seeded: deps.seed.length },
          "access_list.seeded",
        );
    },
  };
}

export type AccessListModule = ReturnType<typeof composeAccessListModule>;
