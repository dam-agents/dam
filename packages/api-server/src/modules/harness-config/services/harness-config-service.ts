import { TRPCError } from "@trpc/server";
import { emit, EventType } from "../../../events.js";
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

const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createHarnessConfigService(deps: {
  surface: string;
  runtimeMutator: RuntimeMutator;
  snapshotRepo: HarnessConfigSnapshotRepo;
  ownerSub: string;
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
      return { hasRun: capabilities != null, snapshot };
    },

    async apply(agentId, change: HarnessConfigChange) {
      await requireOwned(agentId);
      const ts = now();
      await deps.runtimeMutator.bump(agentId, [
        {
          id: `harness-config:${agentId}:${ts}`,
          kind: "harness-config",
          payload: change,
          expiresAt: new Date(ts + EVENT_TTL_MS),
        },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      emit({
        type: EventType.HarnessConfigChanged,
        agentId,
        ownerSub: deps.ownerSub,
      });
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
      emit({
        type: EventType.HarnessConfigChanged,
        agentId,
        ownerSub: deps.ownerSub,
        actorSub: deps.ownerSub,
        surface: deps.surface,
      });
    },
  };

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
    const stored = await deps.snapshotRepo.read(agentId);
    const configOptions = { ...(stored?.configOptions ?? {}) };
    for (const [id, value] of Object.entries(change.configOptions ?? {})) {
      configOptions[id] = value;
    }
    for (const id of unset) delete configOptions[id];
    return { ...patch, configOptions };
  }
}

export function harnessConfigSupported(capabilities: unknown): boolean {
  if (capabilities == null) return true;
  return (capabilities as { harnessConfig?: unknown }).harnessConfig === true;
}

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
