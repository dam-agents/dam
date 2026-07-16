import type { Db } from "db";
import type { AgentsService } from "api-server-api";
import { createSandboxesRepository } from "./infrastructure/sandboxes-repository.js";
import {
  createSandboxesService,
  type SandboxesService,
} from "./services/sandboxes-service.js";
import {
  createSandboxSweeper,
  type SandboxSweeper,
} from "./services/sandbox-sweeper.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

/** Compose the owner-scoped Sandboxes service. Owner is bound here so the same
 *  factory backs the harness REST routes and the in-pod `node_done` MCP tool
 *  without either passing an owner through request input. */
export function composeSandboxesForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): SandboxesService {
  return createSandboxesService({
    owner: opts.owner,
    repo: createSandboxesRepository(opts.db),
    agents: opts.agents,
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
  });
}

/** Compose the boot-level liveness + auto-destroy sweep. Owner-agnostic (it
 *  scans every owner's sandboxes), so it builds its own repository and takes an
 *  owner-scoped agents factory to delete terminal sandboxes. Started once. */
export function composeSandboxSweeper(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  intervalMs: number;
  batchSize: number;
}): SandboxSweeper {
  return createSandboxSweeper({
    repo: createSandboxesRepository(opts.db),
    agentsFor: opts.agentsFor,
    intervalMs: opts.intervalMs,
    batchSize: opts.batchSize,
  });
}
