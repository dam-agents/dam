import { TRPCError } from "@trpc/server";
import {
  harnessConfigCatalog,
  type HarnessConfigCatalog,
} from "agent-runtime-api";
import type {
  HarnessConfigChange,
  HarnessConfigService,
  HarnessConfigSnapshotPatch,
} from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { getLogger } from "../../../core/logger.js";

// Long TTL (matching workspace-seed) so a change doesn't expire before the agent is next up.
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createHarnessConfigService(deps: {
  runtimeMutator: RuntimeMutator;
  snapshotRepo: HarnessConfigSnapshotRepo;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  isSettled: (agentId: string) => Promise<boolean>;
  now?: () => number;
}): HarnessConfigService {
  const now = deps.now ?? (() => Date.now());

  async function requireOwned(agentId: string): Promise<void> {
    if (!(await deps.isOwnedAgent(agentId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
  }

  return {
    async status(agentId) {
      await requireOwned(agentId);
      const capabilities = await deps.getCapabilities(agentId);
      return {
        supported: harnessConfigSupported(capabilities),
        catalog: harnessConfigCatalogOf(capabilities),
      };
    },

    async settled(agentId) {
      await requireOwned(agentId);
      return { settled: await deps.isSettled(agentId) };
    },

    async snapshot(agentId) {
      await requireOwned(agentId);
      const [capabilities, snapshot] = await Promise.all([
        deps.getCapabilities(agentId),
        deps.snapshotRepo.read(agentId),
      ]);
      // Capabilities only exist once the agent has hello'd, which is also the
      // only way anything could have been captured.
      return { hasRun: capabilities != null, snapshot };
    },

    async apply(agentId, change: HarnessConfigChange) {
      await requireOwned(agentId);
      const ts = now();
      // Event id `<kind>:<dedupe-key>:<fire-ts>` (agent splits on the last `:`).
      // The monotonic ts makes each apply fresh; the runtime_events PK on id
      // rejects a same-millisecond double-apply (loud 500).
      await deps.runtimeMutator.bump(agentId, [
        {
          id: `harness-config:${agentId}:${ts}`,
          kind: "harness-config",
          payload: change,
          expiresAt: new Date(ts + EVENT_TTL_MS),
        },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      // After the bump, never before: a snapshot must not claim a change that
      // never fired. Declared only — the pod's report is what confirms it.
      // Swallowed: the change has already fired by now, so failing the caller
      // here would report "couldn't apply" for a change that did apply. The
      // pod's next report rebuilds the snapshot anyway.
      try {
        await deps.snapshotRepo.merge(
          agentId,
          await declaredBy(agentId, change),
          { confirmed: false },
        );
      } catch (err) {
        getLogger().warn(
          { err, agentId },
          "harness-config: recording the declared snapshot failed",
        );
      }
    },
  };

  /** What an apply asserts about the harness's file, as a snapshot patch.
   *  `unset` clears: model/mode go null, a config option leaves the record. */
  async function declaredBy(
    agentId: string,
    change: HarnessConfigChange,
  ): Promise<HarnessConfigSnapshotPatch> {
    const unset = new Set(change.unset ?? []);
    const patch: HarnessConfigSnapshotPatch = {};
    if (change.model !== undefined) patch.model = change.model;
    if (unset.has("model")) patch.model = null;
    if (change.mode !== undefined) patch.mode = change.mode;
    if (unset.has("mode")) patch.mode = null;

    const optionIds = [
      ...Object.keys(change.configOptions ?? {}),
      ...[...unset].filter((f) => f !== "model" && f !== "mode"),
    ];
    if (optionIds.length === 0) return patch;
    // Per-key, not wholesale: an apply carries only the option it changed, so
    // replacing the record would drop the others until the pod reports back.
    const stored = await deps.snapshotRepo.read(agentId);
    const configOptions = { ...(stored?.configOptions ?? {}) };
    for (const [id, value] of Object.entries(change.configOptions ?? {})) {
      configOptions[id] = value;
    }
    for (const id of unset) delete configOptions[id];
    return { ...patch, configOptions };
  }
}

// Unknown capabilities (agent never booted) count as supported so the UI doesn't flicker off on first start.
export function harnessConfigSupported(capabilities: unknown): boolean {
  if (capabilities == null) return true;
  return (capabilities as { harnessConfig?: unknown }).harnessConfig === true;
}

// The catalog advertised on `hello`, validated; null when absent or malformed.
function harnessConfigCatalogOf(
  capabilities: unknown,
): HarnessConfigCatalog | null {
  if (capabilities == null) return null;
  const raw = (capabilities as { harnessConfigCatalog?: unknown })
    .harnessConfigCatalog;
  if (raw == null) return null;
  const parsed = harnessConfigCatalog.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
