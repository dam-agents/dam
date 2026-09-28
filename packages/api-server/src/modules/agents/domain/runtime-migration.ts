import type {
  AbortRuntimeMigrationError,
  AgentSpec,
  MigrateRuntimeError,
  RetryRuntimeMigrationError,
  RuntimeMigration,
  RuntimeMigrationPhase,
  UnmovablePath,
} from "api-server-api";

export const AGENT_HOME = "/home/agent";

// UNIT_BOUNDARY_DESCRIPTION: where the migration puts a persisted path from outside HOME, below HOME, so the machine's one disk keeps it; a boot hook the migration puts in the home links the old path to it on every boot.
const PERSISTED_DIR = ".persisted";

// UNIT_BOUNDARY_DESCRIPTION: guest paths the platform lays out or the kernel owns. A persisted path at one of them, inside one, or above one would replace it with a link into the home at boot, so the migration refuses it.
const UNMOVABLE_PATHS: readonly string[] = [
  "/proc",
  "/sys",
  "/dev",
  "/platform",
  "/mnt/platform",
  "/workspace",
  "/storage",
  "/etc/platform",
  "/var/cache/platform",
];

export function isVmBackend(spec: AgentSpec): boolean {
  return spec.backend?.type === "vm";
}

// UNIT_BOUNDARY_DESCRIPTION: what the api-server reads to know a migration's state: its own request, and the RuntimeMigrating condition the controller writes with the copy attempts beside it. A request from before the condition existed carries the controller's phase and message in annotations instead.
export interface RuntimeMigrationSignals {
  requested?: string;
  legacyMessage?: string;
  condition?: { reason?: string; message?: string };
  attempts?: number;
  vm: boolean;
}

const CONDITION_PHASES: Record<string, RuntimeMigrationPhase> = {
  Requested: "requested",
  Stopping: "stopping",
  Copying: "copying",
  Booting: "booting",
  Verified: "verified",
  Failed: "failed",
};

const LEGACY_PHASES: Record<string, RuntimeMigrationPhase> = {
  copying: "copying",
  booting: "booting",
};

// UNIT_BOUNDARY_DESCRIPTION: the migration the browser is shown. With the request withdrawn but the condition still there, the controller is still removing the vm side of an abort, or finishing one whose Backend has switched. A phase this api-server does not know yet still means the migration is running, so it reads as "requested" rather than as no migration at all. A migration can be aborted until its machine has booted from the copy, and retried only once it has failed.
export function runtimeMigrationOf(
  signals: RuntimeMigrationSignals,
): RuntimeMigration | undefined {
  const { requested, condition } = signals;
  if (!requested && !condition) return undefined;
  let phase: RuntimeMigrationPhase;
  let message = condition?.message || undefined;
  if (!requested) phase = signals.vm ? "verified" : "aborting";
  else if (condition)
    phase = CONDITION_PHASES[condition.reason ?? ""] ?? "requested";
  else {
    phase = LEGACY_PHASES[requested] ?? "requested";
    message = signals.legacyMessage || undefined;
  }
  const attempts = signals.attempts ?? 0;
  return {
    phase,
    ...(message ? { message } : {}),
    ...(attempts > 0 ? { attempts } : {}),
    abortable:
      !!requested &&
      !signals.vm &&
      phase !== "verified" &&
      phase !== "aborting",
    retryable: !!requested && phase === "failed",
  };
}

function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function unmovableReason(path: string): string | null {
  const parts = path.split("/");
  if (
    !path.startsWith("/") ||
    parts.slice(1).some((p) => p === "" || p === "." || p === "..")
  )
    return "it is not a plain absolute path";
  if (path === "/") return "it is the whole machine";
  for (const kept of [AGENT_HOME, ...UNMOVABLE_PATHS]) {
    if (within(path, kept) || within(kept, path))
      return `it would hide or sit inside ${kept}, which the new runtime lays out itself`;
  }
  return null;
}

export interface PersistedMoves {
  moves: Record<string, string>;
  unmovable: UnmovablePath[];
}

// UNIT_BOUNDARY_DESCRIPTION: where each persisted path of a container Agent goes on the machine. On the container backend every persisted mount is a volume of its own; the machine has one disk holding HOME, so the controller copies each volume into it. A path under HOME stays where it is. A path outside HOME moves to the same path below HOME's persisted directory — /data to /home/agent/.persisted/data — and a boot hook links /data to it. What cannot be moved is named with the reason: a path whose link would replace one the platform lays out, or HOME or anything above it, and one already inside the persisted directory, whose place a moved path would take.
export function planPersistedMoves(spec: AgentSpec): PersistedMoves {
  const persistedDir = `${AGENT_HOME}/${PERSISTED_DIR}`;
  const moves: Record<string, string> = {};
  const unmovable: UnmovablePath[] = [];
  for (const m of spec.mounts ?? []) {
    if (within(m.path, persistedDir)) {
      unmovable.push({
        path: m.path,
        reason: `${persistedDir} is where the new runtime puts paths it moves into the home`,
      });
      continue;
    }
    if (!m.persist || m.path === AGENT_HOME) continue;
    if (within(m.path, AGENT_HOME)) {
      moves[m.path] = m.path;
      continue;
    }
    const reason = unmovableReason(m.path);
    if (reason) unmovable.push({ path: m.path, reason });
    else moves[m.path] = `${persistedDir}${m.path}`;
  }
  return { moves, unmovable };
}

export function isRuntimeMigratable(spec: AgentSpec): boolean {
  return !isVmBackend(spec) && planPersistedMoves(spec).unmovable.length === 0;
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
  const { unmovable } = planPersistedMoves(agent.spec);
  if (unmovable.length > 0)
    return { type: "PersistsUnmovablePaths", paths: unmovable };
  return null;
}

const UNITS: Record<string, number> = {
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
};

function quantityBytes(q: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(q.trim());
  const factor = m ? UNITS[m[2] ?? ""] : undefined;
  return m && factor !== undefined ? Number(m[1]) * factor : null;
}

// UNIT_BOUNDARY_DESCRIPTION: the machine's disk holds what each of the container's volumes held, so a moved Agent is sized for all of them together: the sum of every persisted mount's size, each falling back to the Agent's storageSize and then the install default as the container backend sizes them, rounded up to whole GiB, and never less than the Agent already asks for. The runner refuses a seed larger than the disk, so a disk sized for the largest volume alone could not take the copy. Undefined when nothing but HOME moves, or when a size cannot be read, and the disk keeps the size the Agent asks for.
export function movedStorageSize(
  spec: AgentSpec,
  moves: Record<string, string>,
  defaultStorageSize: string,
): string | undefined {
  if (Object.keys(moves).length === 0) return undefined;
  const asked = quantityBytes(spec.storageSize ?? defaultStorageSize);
  if (asked === null) return undefined;
  let bytes = 0;
  for (const m of spec.mounts ?? []) {
    if (!m.persist) continue;
    const size = quantityBytes(
      m.size ?? spec.storageSize ?? defaultStorageSize,
    );
    if (size === null) return undefined;
    bytes += size;
  }
  return `${Math.ceil(Math.max(bytes, asked) / 1024 ** 3)}Gi`;
}

type Mounts = NonNullable<AgentSpec["mounts"]>;

// UNIT_BOUNDARY_DESCRIPTION: the shape the Agent takes on the vm backend, which the controller builds its machine to while the container spec stays the Agent's spec. When persisted paths move, the mounts are rewritten to where they now live, so the moved Agent is one the vm backend accepts, and its disk is sized for all of them.
export interface RuntimeMigrationTarget {
  mounts?: Mounts;
  storageSize?: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the fields the Backend switch changes, as they were when the migration was requested. An abort writes them back, and an operator recovering an Agent by hand reads them here rather than reconstructing them.
export interface RuntimeMigrationSnapshot {
  backend: AgentSpec["backend"] | null;
  mounts: Mounts | null;
  storageSize: string | null;
  runtimeClassName: string | null;
  nodeSelector: Record<string, string> | null;
}

// UNIT_BOUNDARY_DESCRIPTION: what a migration request records. No spec is written: the Backend switches only once the controller reports the machine booted from the copy. The moves are recorded too, for the controller, which finds each old volume by the path it was made for.
export function runtimeMigrationRequest(
  spec: AgentSpec,
  defaultStorageSize: string,
): {
  target: RuntimeMigrationTarget;
  snapshot: RuntimeMigrationSnapshot;
  moves: Record<string, string>;
} {
  const { moves } = planPersistedMoves(spec);
  const target: RuntimeMigrationTarget = {};
  if (Object.keys(moves).length > 0) {
    target.mounts = (spec.mounts ?? []).map((m) => {
      const to = m.persist ? moves[m.path] : undefined;
      return to ? { ...m, path: to } : m;
    });
    const size = movedStorageSize(spec, moves, defaultStorageSize);
    if (size) target.storageSize = size;
  }
  const snapshot: RuntimeMigrationSnapshot = {
    backend: spec.backend ?? null,
    mounts: spec.mounts ?? null,
    storageSize: spec.storageSize ?? null,
    runtimeClassName: spec.runtimeClassName ?? null,
    nodeSelector: spec.nodeSelector ?? null,
  };
  return { target, snapshot, moves };
}

function parseRecord<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

export function parseRuntimeMigrationTarget(
  raw: string | undefined,
): RuntimeMigrationTarget | null {
  return parseRecord<RuntimeMigrationTarget>(raw);
}

export function parseRuntimeMigrationSnapshot(
  raw: string | undefined,
): RuntimeMigrationSnapshot | null {
  return parseRecord<RuntimeMigrationSnapshot>(raw);
}

// UNIT_BOUNDARY_DESCRIPTION: the spec half of the Backend switch, written once the machine has booted from the copy. The CRD rejects runtimeClassName and nodeSelector on the vm backend, so both are cleared in the same write.
export function runtimeMigrationSwitchSpec(
  target: RuntimeMigrationTarget,
): Record<string, unknown> {
  return {
    backend: { type: "vm" },
    runtimeClassName: null,
    nodeSelector: null,
    ...(target.mounts ? { mounts: target.mounts } : {}),
    ...(target.storageSize ? { storageSize: target.storageSize } : {}),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the spec half of an abort: the fields the switch would change, put back as the snapshot recorded them. The Backend itself is left out, since nothing but the switch writes it and the switch has not happened.
export function runtimeMigrationRestoreSpec(
  snapshot: RuntimeMigrationSnapshot,
): Record<string, unknown> {
  return {
    mounts: snapshot.mounts,
    storageSize: snapshot.storageSize,
    runtimeClassName: snapshot.runtimeClassName,
    nodeSelector: snapshot.nodeSelector,
  };
}

export function abortRuntimeMigrationRefusal(agent: {
  runtimeMigration?: RuntimeMigration;
}): AbortRuntimeMigrationError | null {
  const migration = agent.runtimeMigration;
  if (!migration || migration.phase === "aborting")
    return { type: "NoRuntimeMigration" };
  if (!migration.abortable) return { type: "RuntimeMigrationVerified" };
  return null;
}

export function retryRuntimeMigrationRefusal(agent: {
  runtimeMigration?: RuntimeMigration;
}): RetryRuntimeMigrationError | null {
  const migration = agent.runtimeMigration;
  if (!migration || migration.phase === "aborting")
    return { type: "NoRuntimeMigration" };
  if (!migration.retryable) return { type: "RuntimeMigrationNotFailed" };
  return null;
}

// UNIT_BOUNDARY_DESCRIPTION: whether the api-server should now switch the Backend: the controller reports the machine booted from the copy, and the request that asked for it still stands.
export function runtimeMigrationReadyToSwitch(agent: {
  spec: AgentSpec;
  runtimeMigration?: RuntimeMigration;
}): boolean {
  return (
    !isVmBackend(agent.spec) && agent.runtimeMigration?.phase === "verified"
  );
}
