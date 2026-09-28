import type {
  AgentSpec,
  MigrateRuntimeError,
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

function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function plainPathReason(path: string): string | null {
  const parts = path.split("/");
  if (
    !path.startsWith("/") ||
    parts.slice(1).some((p) => p === "" || p === "." || p === "..")
  )
    return "it is not a plain absolute path";
  return null;
}

function unmovableReason(path: string): string | null {
  if (path === "/") return "it is the whole machine";
  for (const kept of [AGENT_HOME, ...UNMOVABLE_PATHS]) {
    if (within(path, kept) || within(kept, path))
      return `it would hide or sit inside ${kept}, which the new runtime lays out itself`;
  }
  return null;
}

export type AgentMount = NonNullable<AgentSpec["mounts"]>[number];

// UNIT_BOUNDARY_DESCRIPTION: the mounts the controller renders for an Agent: its own when it names any, else the install's template defaults. The migration plans from these same mounts, so it never flips an Agent the controller would then refuse, or leaves out a path the controller persists.
export function effectiveMounts(
  spec: AgentSpec,
  defaultMounts: readonly AgentMount[],
): readonly AgentMount[] {
  return spec.mounts && spec.mounts.length > 0 ? spec.mounts : defaultMounts;
}

export interface PersistedMoves {
  moves: Record<string, string>;
  unmovable: UnmovablePath[];
}

// UNIT_BOUNDARY_DESCRIPTION: where each persisted path of a container Agent goes on the machine. On the container backend every persisted mount is a volume of its own; the machine has one disk holding HOME, so the controller copies each volume into it. A path under HOME stays where it is. A path outside HOME moves to the same path below HOME's persisted directory — /data to /home/agent/.persisted/data — and a boot hook links /data to it. What cannot be moved is named with the reason: any mount path that is not plain, since the copy cannot place it; a path whose link would replace one the platform lays out, or HOME or anything above it; and one already inside the persisted directory, whose place a moved path would take.
export function planPersistedMoves(
  mounts: readonly AgentMount[],
): PersistedMoves {
  const persistedDir = `${AGENT_HOME}/${PERSISTED_DIR}`;
  const moves: Record<string, string> = {};
  const unmovable: UnmovablePath[] = [];
  for (const m of mounts) {
    const notPlain = plainPathReason(m.path);
    if (notPlain) {
      unmovable.push({ path: m.path, reason: notPlain });
      continue;
    }
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

function persistsHome(mounts: readonly AgentMount[]): boolean {
  return mounts.some((m) => m.persist && m.path === AGENT_HOME);
}

// UNIT_BOUNDARY_DESCRIPTION: the one answer to whether an Agent may be moved to the vm backend, read both by the request and by the view that offers it, so the browser never offers a move the request then refuses. A running migration is checked first: the request switches the Backend in the same write that starts the migration, so a migrating Agent already reads as a vm Agent, and a second request must say the move is under way rather than done. An Agent whose HOME is not persisted has nothing the machine would keep, so it is refused rather than moved empty.
export function runtimeMigrationRefusal(
  agent: {
    spec: AgentSpec;
    runtimeMigration?: RuntimeMigration;
    storageMigrating?: boolean;
  },
  ctx: RuntimeMigrationContext,
): MigrateRuntimeError | null {
  if (agent.runtimeMigration) return { type: "RuntimeMigrationInProgress" };
  if (isVmBackend(agent.spec)) return { type: "AlreadyOnVm" };
  if (!ctx.virtualizationEnabled) return { type: "VirtualizationDisabled" };
  if (agent.storageMigrating) return { type: "StorageMigrationInProgress" };
  const mounts = effectiveMounts(agent.spec, ctx.defaultMounts);
  const { unmovable } = planPersistedMoves(mounts);
  if (unmovable.length > 0)
    return { type: "PersistsUnmovablePaths", paths: unmovable };
  if (!persistsHome(mounts)) return { type: "HomeNotPersisted" };
  return null;
}

export interface RuntimeMigrationContext {
  virtualizationEnabled: boolean;
  defaultMounts: readonly AgentMount[];
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

// UNIT_BOUNDARY_DESCRIPTION: the machine's disk holds what each of the container's volumes held, so a moved Agent is sized for all of them together: the sum of every persisted mount's size, over the mounts the controller renders, each falling back to the Agent's storageSize and then the install default as the container backend sizes them, rounded up to whole GiB, and never less than the Agent already asks for. The runner refuses a seed larger than the disk, so a disk sized for the largest volume alone could not take the copy. Undefined when nothing but HOME moves, or when a size cannot be read, and the disk keeps the size the Agent asks for.
export function movedStorageSize(
  spec: AgentSpec,
  mounts: readonly AgentMount[],
  moves: Record<string, string>,
  defaultStorageSize: string,
): string | undefined {
  if (Object.keys(moves).length === 0) return undefined;
  const asked = quantityBytes(spec.storageSize ?? defaultStorageSize);
  if (asked === null) return undefined;
  let bytes = 0;
  for (const m of mounts) {
    if (!m.persist) continue;
    const size = quantityBytes(
      m.size ?? spec.storageSize ?? defaultStorageSize,
    );
    if (size === null) return undefined;
    bytes += size;
  }
  return `${Math.ceil(Math.max(bytes, asked) / 1024 ** 3)}Gi`;
}

// UNIT_BOUNDARY_DESCRIPTION: the spec half of the one write that requests the migration. The CRD rejects runtimeClassName and nodeSelector on the vm backend, so both are cleared with the backend switch. When persisted paths move, the mounts the controller renders are written out, each at where it now lives, so the moved Agent is one the vm backend accepts, and its disk is sized for all of them. The moves are returned too, for the controller, which finds each old volume by the path it was made for.
export function runtimeMigrationSpecPatch(
  spec: AgentSpec,
  defaultStorageSize: string,
  defaultMounts: readonly AgentMount[],
): { spec: Record<string, unknown>; moves: Record<string, string> } {
  const mounts = effectiveMounts(spec, defaultMounts);
  const { moves } = planPersistedMoves(mounts);
  const patch: Record<string, unknown> = {
    backend: { type: "vm" },
    runtimeClassName: null,
    nodeSelector: null,
  };
  if (Object.keys(moves).length > 0) {
    patch.mounts = mounts.map((m) => {
      const to = m.persist ? moves[m.path] : undefined;
      return to ? { ...m, path: to } : m;
    });
    const size = movedStorageSize(spec, mounts, moves, defaultStorageSize);
    if (size) patch.storageSize = size;
  }
  return { spec: patch, moves };
}
