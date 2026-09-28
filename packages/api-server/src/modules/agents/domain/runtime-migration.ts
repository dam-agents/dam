import type {
  AgentSpec,
  MigrateRuntimeError,
  RuntimeMigration,
  RuntimeMigrationPhase,
} from "api-server-api";

export const AGENT_HOME = "/home/agent";

const PHASES: readonly RuntimeMigrationPhase[] = [
  "requested",
  "copying",
  "booting",
];

export function isVmBackend(spec: AgentSpec): boolean {
  return spec.backend?.type === "vm";
}

// UNIT_BOUNDARY_DESCRIPTION: the controller owns the runtime migration once it is requested and reports its progress in two annotations. A phase this api-server does not know yet still means the migration is running, so it reads as "requested" rather than as no migration at all.
export function runtimeMigrationOf(
  phase: string | undefined,
  message: string | undefined,
): RuntimeMigration | undefined {
  if (!phase) return undefined;
  const known = PHASES.find((p) => p === phase) ?? "requested";
  return message ? { phase: known, message } : { phase: known };
}

// UNIT_BOUNDARY_DESCRIPTION: a vm machine has one disk and it holds HOME, and the migration copies exactly one volume onto it: the one mounted at HOME. On the container backend every persisted mount is a volume of its own, so one nested under HOME would be left behind as surely as one outside it — both are refused before the agent is switched, rather than migrated without their contents.
export function persistedPathsOutsideHome(spec: AgentSpec): string[] {
  return (spec.mounts ?? [])
    .filter((m) => m.persist)
    .map((m) => m.path)
    .filter((p) => p !== AGENT_HOME);
}

export function isRuntimeMigratable(spec: AgentSpec): boolean {
  return !isVmBackend(spec) && persistedPathsOutsideHome(spec).length === 0;
}

export function runtimeMigrationRefusal(
  agent: {
    spec: AgentSpec;
    runtimeMigration?: RuntimeMigration;
    storageMigrating?: boolean;
  },
  virtualizationEnabled: boolean,
): MigrateRuntimeError | null {
  if (isVmBackend(agent.spec)) return { type: "AlreadyOnVm" };
  if (!virtualizationEnabled) return { type: "VirtualizationDisabled" };
  if (agent.runtimeMigration) return { type: "RuntimeMigrationInProgress" };
  if (agent.storageMigrating) return { type: "StorageMigrationInProgress" };
  const outside = persistedPathsOutsideHome(agent.spec);
  if (outside.length > 0)
    return { type: "PersistsOutsideHome", paths: outside };
  return null;
}

export const RUNTIME_MIGRATION_SPEC_PATCH = {
  backend: { type: "vm" },
  runtimeClassName: null,
  nodeSelector: null,
} as const;
