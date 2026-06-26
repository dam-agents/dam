import type { Db } from "db";
import type { ExperimentsService } from "api-server-api";
import { createExperimentsRepository } from "./infrastructure/experiments-repository.js";
import { createExperimentsService } from "./services/experiments-service.js";

export interface ComposeExperimentsForOwnerOpts {
  db: Db;
  owner: string;
  /** Resolve whether the agent exists for this owner — gates `addArm` so an arm
   *  can only reference an owned agent. Omit in contexts without an agents
   *  service (the check is then skipped). */
  agentExists?: (agentId: string) => Promise<boolean>;
}

/** Compose the owner-scoped Experiments service. The owner is bound here, so
 *  the same factory backs both the user tRPC router and the in-pod MCP session
 *  without either passing an owner through request input. No boot-time
 *  singleton: the service is plain db-backed CRUD with no shared worker state. */
export function composeExperimentsForOwner(
  opts: ComposeExperimentsForOwnerOpts,
): { experiments: ExperimentsService } {
  const repo = createExperimentsRepository(opts.db);
  return {
    experiments: createExperimentsService({
      owner: opts.owner,
      repo,
      ...(opts.agentExists ? { agentExists: opts.agentExists } : {}),
    }),
  };
}
