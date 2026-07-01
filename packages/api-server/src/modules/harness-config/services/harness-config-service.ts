import { TRPCError } from "@trpc/server";
import {
  harnessConfigCatalog,
  type HarnessConfigCatalog,
} from "agent-runtime-api";
import type { HarnessConfigChange, HarnessConfigService } from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

// Long TTL (matching workspace-seed) so a change doesn't expire before the agent is next up.
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createHarnessConfigService(deps: {
  runtimeMutator: RuntimeMutator;
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
    },
  };
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
