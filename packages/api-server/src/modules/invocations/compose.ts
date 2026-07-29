import type { Db } from "db";
import type { AgentsService, InvocationsQueryService } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { createExperimentsRepository } from "../experiments/infrastructure/experiments-repository.js";
import { createInvocationsRepository } from "./infrastructure/invocations-repository.js";
import {
  createInvocationsService,
  type InvocationsService,
} from "./services/invocations-service.js";
import {
  createInvocationLivenessSweep,
  type InvocationLivenessSweep,
} from "./services/invocation-liveness.js";
import {
  createDriverResolution,
  type DriverResolution,
} from "./services/driver-resolution.js";
import { createDriverCascade } from "./services/driver-cascade.js";
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
  const experimentsRepo = createExperimentsRepository(opts.db);
  return createInvocationsService({
    owner: opts.owner,
    repo: createInvocationsRepository(opts.db),
    agents: opts.agents,
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    isExperimentRunning: async (experimentId, driverAgentId) => {
      const row = await experimentsRepo.get(experimentId, opts.owner);
      return row?.status === "running" && row.driverAgentId === driverAgentId;
    },
  });
}

/** Compose the owner-scoped read surface the UI's tRPC context carries. Reads
 *  only — spawning stays on the harness REST port. */
export function composeInvocationsQueryForOwner(opts: {
  db: Db;
  owner: string;
}): InvocationsQueryService {
  const repo = createInvocationsRepository(opts.db);
  return {
    listTargets: () => repo.listTargetsByOwner(opts.owner),
  };
}

/** Compose the boot-level Invocation liveness sweep. Owner-agnostic (it scans
 *  every owner's Invocations), so it builds its own repository and takes an
 *  owner-scoped agents factory to reap liveness-failed targets. Started once. */
export function composeInvocationLivenessSweep(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  k8s: Pick<K8sClient, "readAgentPodRestart">;
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

/**
 * System-level read adapter consumed by the approvals module's ext_authz gate
 * on the egress hot path (Egress Aliasing): resolves an Invocation target to
 * the root driver whose egress policy applies. Not owner-scoped — identity
 * flows from the per-Agent ext-authz Service, and the driver's owner is
 * resolved by the gate's identity resolver afterwards.
 */
export function createDriverResolutionAdapter(db: Db): DriverResolution {
  return createDriverResolution({ repo: createInvocationsRepository(db) });
}

/**
 * Per-agent cleanup hook registered with `composeAgentsModule` (Driver
 * Cascade): fails the deleted agent's running Invocations — driven and own —
 * and eagerly reaps the driven targets, unwinding chains transitively via
 * each target's own delete hooks.
 */
export function createInvocationsCleanupHook(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
}): (agentId: string) => Promise<void> {
  return createDriverCascade({
    repo: createInvocationsRepository(opts.db),
    agentsFor: opts.agentsFor,
  });
}

/**
 * Read primitive used by the orphan sweeper saga: every agent id a running
 * Invocation references (targets and drivers), so a cascade missed here
 * (replica died mid-delete) is replayed once the saga sees the agent gone.
 */
export function listInvocationAgentIds(db: Db): Promise<string[]> {
  // Grace: the row is written before the agent exists in K8s (spawn ordering),
  // and the sweeper snapshots K8s before reading rows — young rows would read
  // as orphans. A missed cascade replay delayed by minutes is harmless.
  const olderThan = new Date(Date.now() - INVOCATION_ORPHAN_GRACE_MS);
  return createInvocationsRepository(db).listRunningAgentIds(olderThan);
}

const INVOCATION_ORPHAN_GRACE_MS = 5 * 60_000;

export type { DriverResolution } from "./services/driver-resolution.js";
