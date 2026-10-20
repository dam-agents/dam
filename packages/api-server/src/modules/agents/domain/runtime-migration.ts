import type {
  AbortRuntimeMigrationError,
  AgentSpec,
  RetryRuntimeMigrationError,
  RuntimeMigration,
  RuntimeMigrationPhase,
  RuntimeMigrationRefusal,
  UnmovablePath,
} from "api-server-api";
import { match } from "ts-pattern";
import { STORAGE_FULL_PERCENT } from "../../budgets/domain/vm-usage.js";

export const AGENT_HOME = "/home/agent";

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

export type AgentMount = NonNullable<AgentSpec["mounts"]>[number];

// UNIT_BOUNDARY_DESCRIPTION: the mounts the controller renders for an Agent: its own when it names any, else the install's template defaults. The migration plans from these same mounts, so it never flips an Agent the controller would then refuse, or leaves out a path the controller persists.
export function effectiveMounts(
  spec: AgentSpec,
  defaultMounts: readonly AgentMount[],
): readonly AgentMount[] {
  return spec.mounts && spec.mounts.length > 0 ? spec.mounts : defaultMounts;
}

// UNIT_BOUNDARY_DESCRIPTION: the persisted paths a migration cannot carry, each with the reason. The migration copies only HOME's volume, the one path a machine keeps whatever image it boots, so every other persisted mount — outside HOME, or a volume of its own inside it — would be lost, and the Agent is refused rather than moved without it. A mount that is not persisted keeps nothing on either backend, so it is no reason to refuse.
export function unmovablePaths(mounts: readonly AgentMount[]): UnmovablePath[] {
  return mounts
    .filter((m) => m.persist && m.path !== AGENT_HOME)
    .map((m) => ({
      path: m.path,
      reason: "a move carries only the home directory",
    }));
}

function persistsHome(mounts: readonly AgentMount[]): boolean {
  return mounts.some((m) => m.persist && m.path === AGENT_HOME);
}

// UNIT_BOUNDARY_DESCRIPTION: the one answer to whether an Agent may be moved to the vm backend, read both by the request and by the view that offers it, so the browser never offers a move the request then refuses. A running migration is checked first — one under way, failed, or still clearing up an abort — so a second request says the move is under way rather than anything else, and the view offers no second one. An Agent whose HOME is not persisted has nothing the machine would keep, so it is refused rather than moved empty. The owner's pool is checked last, and only where it was read — the request and the plan, never a list — because a move it cannot hold would fill the storage the owner's other VM agents share, or boot a machine the pool has no memory for.
export function runtimeMigrationRefusal(
  agent: {
    spec: AgentSpec;
    runtimeMigration?: RuntimeMigration;
    storageMigrating?: boolean;
  },
  ctx: RuntimeMigrationContext,
): RuntimeMigrationRefusal | null {
  if (agent.runtimeMigration) return { type: "RuntimeMigrationInProgress" };
  if (isVmBackend(agent.spec)) return { type: "AlreadyOnVm" };
  if (!ctx.virtualizationEnabled) return { type: "VirtualizationDisabled" };
  if (agent.storageMigrating) return { type: "StorageMigrationInProgress" };
  const mounts = effectiveMounts(agent.spec, ctx.defaultMounts);
  const unmovable = unmovablePaths(mounts);
  if (unmovable.length > 0)
    return { type: "PersistsUnmovablePaths", paths: unmovable };
  if (!persistsHome(mounts)) return { type: "HomeNotPersisted" };
  if (!ctx.capacity) return null;
  return poolRefusal(
    ctx.capacity,
    ctx.homeBytes ?? null,
    homeVolumeBytes(agent.spec, mounts, ctx.defaultStorageSize),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: whether the move fits the owner's pool. Its storage holds the seed and then as much again on the machine's first disk, so the move needs about twice what the home holds — what the Agent's own runtime measured there, and nothing where it could not be read, because the volume's size is the most it may hold rather than what it does, and refusing a small home on a large claim is what the measured figure is for. A measurement above the volume's own size is not the home at all: it is the filesystem the volume sits on, which a claim backed by a directory on a node shares with everything else there, so it is read as the volume at most. The pool keeps the rest of the owner's agents safe up to the level the runner itself refuses an upload at. Its memory has to take one more machine, which may grow to half the pool; the reserve the runner keeps back is left out, so this never refuses a machine the runner would have admitted.
function poolRefusal(
  capacity: VmPoolCapacity,
  measuredBytes: number | null,
  volumeBytes: number | null,
): RuntimeMigrationRefusal | null {
  const { storage, memory } = capacity;
  const homeBytes =
    measuredBytes === null || volumeBytes === null
      ? measuredBytes
      : Math.min(measuredBytes, volumeBytes);
  const needed = 2 * (homeBytes ?? 0);
  if (
    storage.usedBytes + needed >
    (storage.usableBytes * STORAGE_FULL_PERCENT) / 100
  )
    return {
      type: "VmStorageInsufficient",
      neededBytes: needed,
      usedBytes: storage.usedBytes,
      usableBytes: storage.usableBytes,
    };
  if (
    memory.limitMiB > 0 &&
    memory.committedMiB + memory.limitMiB / 2 > memory.limitMiB
  )
    return {
      type: "VmMemoryInsufficient",
      committedMiB: memory.committedMiB,
      limitMiB: memory.limitMiB,
    };
  return null;
}

export interface RuntimeMigrationContext {
  virtualizationEnabled: boolean;
  defaultMounts: readonly AgentMount[];
  defaultStorageSize: string;
  // UNIT_BOUNDARY_DESCRIPTION: the owner's pool, as their runner reported it or, with no runner yet, as the install sizes it. Read where a move is decided and absent from the list views, which would pay a runner read per request for a flag. Unmeasured or unreachable is null, which refuses nothing: the runner refuses what it has no room for on its own.
  capacity?: VmPoolCapacity | null;
  // UNIT_BOUNDARY_DESCRIPTION: what HOME holds, as the Agent's own runtime measured it. Absent for an Agent that is not running, whose volume cannot be read without starting it, and nulls the storage half of the refusal rather than judging a home by the size its volume may grow to.
  homeBytes?: number | null;
}

// UNIT_BOUNDARY_DESCRIPTION: the owner's VM pool, in the runner's own units: the storage every machine disk and the seed share, and the memory the runner holds its machines to, with what is committed against it. That memory is its pod's limit on a cluster, and a share of the host on a laptop. Where the cluster resizes pods in place, a runner caps admission further at what the node has granted its pod, except for a restart of a machine it already runs, whose boot replaces memory it already holds.
export interface VmPoolCapacity {
  storage: { usedBytes: number; usableBytes: number };
  memory: { committedMiB: number; limitMiB: number };
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

// UNIT_BOUNDARY_DESCRIPTION: the machine's disk holds what HOME's volume held, so it is sized for that volume as the container backend sized it: its own size when the mount names one, rounded up to whole GiB. Undefined when HOME names no size or no more than the Agent already asks for, or when a size cannot be read, and the disk keeps the size the Agent asks for, with the install default behind it.
export function movedStorageSize(
  spec: AgentSpec,
  mounts: readonly AgentMount[],
  defaultStorageSize: string,
): string | undefined {
  const home = mounts.find((m) => m.persist && m.path === AGENT_HOME);
  if (!home?.size) return undefined;
  const asked = quantityBytes(spec.storageSize ?? defaultStorageSize);
  const size = quantityBytes(home.size);
  if (asked === null || size === null || size <= asked) return undefined;
  return `${Math.ceil(size / 1024 ** 3)}Gi`;
}

type Mounts = AgentMount[];

// UNIT_BOUNDARY_DESCRIPTION: the most HOME's volume may hold, which no measurement of the home can exceed: the volume's own size when the mount names one, else the Agent's storageSize, else the install default, rounded up to whole GiB as the machine's disk is. Null when the size cannot be read, which leaves a measurement uncapped.
export function homeVolumeBytes(
  spec: AgentSpec,
  mounts: readonly AgentMount[],
  defaultStorageSize: string,
): number | null {
  const size =
    movedStorageSize(spec, mounts, defaultStorageSize) ??
    spec.storageSize ??
    defaultStorageSize;
  return quantityBytes(size);
}

// UNIT_BOUNDARY_DESCRIPTION: the shape the Agent takes on the vm backend, which the controller builds its machine to while the container spec stays the Agent's spec: the disk sized for HOME's volume when that is more than the Agent asks for. The mounts stay as they are, since HOME is already where the machine keeps it.
export interface RuntimeMigrationTarget {
  storageSize?: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the fields the Backend switch changes, as they were when the migration was requested. An abort writes them back as the spec had them, so an Agent that named no mounts goes on inheriting the install's; the mounts the controller rendered from them are recorded beside, for an operator recovering an Agent by hand rather than reconstructing them.
export interface RuntimeMigrationSnapshot {
  backend: AgentSpec["backend"] | null;
  mounts: Mounts | null;
  effectiveMounts: Mounts;
  storageSize: string | null;
  runtimeClassName: string | null;
  nodeSelector: Record<string, string> | null;
}

// UNIT_BOUNDARY_DESCRIPTION: what a migration request records. No spec is written: the Backend switches only once the controller reports the machine booted from the copy.
export function runtimeMigrationRequest(
  spec: AgentSpec,
  defaultStorageSize: string,
  defaultMounts: readonly AgentMount[],
): {
  target: RuntimeMigrationTarget;
  snapshot: RuntimeMigrationSnapshot;
} {
  const mounts = effectiveMounts(spec, defaultMounts);
  const target: RuntimeMigrationTarget = {};
  const size = movedStorageSize(spec, mounts, defaultStorageSize);
  if (size) target.storageSize = size;
  const snapshot: RuntimeMigrationSnapshot = {
    backend: spec.backend ?? null,
    mounts: spec.mounts ? [...spec.mounts] : null,
    effectiveMounts: [...mounts],
    storageSize: spec.storageSize ?? null,
    runtimeClassName: spec.runtimeClassName ?? null,
    nodeSelector: spec.nodeSelector ?? null,
  };
  return { target, snapshot };
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

// UNIT_BOUNDARY_DESCRIPTION: whether a migration keeps the Agent from answering, which is what makes it read as migrating, refuses a wake at once and holds a schedule fire. The container keeps running through the preflight, so a requested migration holds nothing yet. From the stop until the machine has booted from the copy, nothing answers. A verified machine answers, and an abort brings the container back, so both are waited for like any start. A failure holds the Agent only when it came after the stop, which the controller marks by recording the old volumes; a preflight failure never stopped the container.
export type RuntimeMigrationHold = "none" | "migrating" | "failed";

export function runtimeMigrationHold(
  migration: RuntimeMigration | undefined,
  containerStopped: boolean,
): RuntimeMigrationHold {
  if (!migration) return "none";
  return match(migration.phase)
    .with("requested", "verified", "aborting", () => "none" as const)
    .with("stopping", "copying", "booting", () => "migrating" as const)
    .with("failed", (): RuntimeMigrationHold =>
      containerStopped ? "failed" : "none",
    )
    .exhaustive();
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
