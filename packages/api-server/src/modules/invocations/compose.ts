import type { Db } from "db";
import type { AgentsService } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { createInvocationsRepository } from "./infrastructure/invocations-repository.js";
import {
  createInvocationsService,
  type InvocationsService,
} from "./services/invocations-service.js";
import {
  createInvocationLivenessSweep,
  type InvocationLivenessSweep,
} from "./services/invocation-liveness.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

/** Compose the owner-scoped Invocations service. Owner is bound here so the
 *  same factory backs the harness REST routes and the in-pod `report_result`
 *  MCP tool without either passing an owner through request input. */
export function composeInvocationsForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): InvocationsService {
  return createInvocationsService({
    owner: opts.owner,
    repo: createInvocationsRepository(opts.db),
    agents: opts.agents,
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
  });
}

/** Compose the boot-level Invocation liveness sweep. Owner-agnostic (it scans
 *  every owner's Invocations), so it builds its own repository and takes an
 *  owner-scoped agents factory to reap liveness-failed targets. Started once. */
export function composeInvocationLivenessSweep(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  k8s: Pick<K8sClient, "readPodRestart">;
  intervalMs: number;
  batchSize: number;
}): InvocationLivenessSweep {
  return createInvocationLivenessSweep({
    repo: createInvocationsRepository(opts.db),
    agentsFor: opts.agentsFor,
    k8s: opts.k8s,
    intervalMs: opts.intervalMs,
    batchSize: opts.batchSize,
  });
}
