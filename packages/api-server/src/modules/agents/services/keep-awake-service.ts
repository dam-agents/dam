import type { K8sClient } from "../infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../infrastructure/labels.js";

// One workload-held keep-awake lease (mirrors the CRD KeepAwakePin).
export interface KeepAwakePin {
  id: string;
  value?: number; // minutes; 0 / omitted = never hibernate
  createdAt: string; // RFC3339
}

// What governs current: the UI baseline, or the workload pins. Default manual.
export type HibernationTimeoutSource = "manual" | "pins";

interface KeepAwakeSpec {
  baseHibernationTimeoutMin?: number | null;
  keepAwakePins?: KeepAwakePin[];
  currentHibernationTimeoutSource?: HibernationTimeoutSource | null;
}

export interface KeepAwakeService {
  // Add a lease for this agent; throws if id already exists. value 0/omitted = never.
  acquire(agentId: string, id: string, value?: number): Promise<void>;
  // Remove a lease by id; idempotent (no error if absent).
  release(agentId: string, id: string): Promise<void>;
  // Drop all leases; current reverts to the baseline.
  purge(agentId: string): Promise<void>;
}

// Materialized current: the most-awake live pin (never wins), else the baseline.
export function currentFromPins(
  pins: readonly { value?: number }[],
  baseline: number | null,
): number | null {
  if (pins.length === 0) return baseline;
  let best = -1;
  for (const p of pins) {
    const v = p.value ?? 0;
    if (v <= 0) return 0;
    if (v > best) best = v;
  }
  return best;
}

export function createKeepAwakeService(k8s: K8sClient): KeepAwakeService {
  async function readSpec(agentId: string): Promise<KeepAwakeSpec> {
    const obj = await k8s.getCustomObject(AGENTS_PLURAL, agentId);
    if (!obj) throw new Error(`agent ${agentId} not found`);
    return (obj.spec ?? {}) as KeepAwakeSpec;
  }

  // Merge-patch only the given keys (replaces the pin array wholesale; one harness serializes its calls, so no retry loop). Omitting a key leaves it untouched.
  async function write(
    agentId: string,
    patch: {
      pins?: KeepAwakePin[];
      current?: number | null;
      source?: HibernationTimeoutSource;
    },
  ): Promise<void> {
    const spec: Record<string, unknown> = {};
    if (patch.pins !== undefined) spec.keepAwakePins = patch.pins;
    if (patch.current !== undefined)
      spec.currentHibernationTimeoutMin = patch.current;
    if (patch.source !== undefined)
      spec.currentHibernationTimeoutSource = patch.source;
    await k8s.patchCustomObject(AGENTS_PLURAL, agentId, { spec });
  }

  return {
    async acquire(agentId, id, value) {
      const spec = await readSpec(agentId);
      const pins = spec.keepAwakePins ?? [];
      if (pins.some((p) => p.id === id)) {
        throw new Error(`keep-awake pin "${id}" already exists`);
      }
      const pin: KeepAwakePin = {
        id,
        ...(value !== undefined ? { value } : {}),
        createdAt: new Date().toISOString(),
      };
      // An acquire always takes over: pins govern current from here.
      const next = [...pins, pin];
      await write(agentId, {
        pins: next,
        current: currentFromPins(next, spec.baseHibernationTimeoutMin ?? null),
        source: "pins",
      });
    },

    async release(agentId, id) {
      const spec = await readSpec(agentId);
      const pins = spec.keepAwakePins ?? [];
      const remaining = pins.filter((p) => p.id !== id);
      const baseline = spec.baseHibernationTimeoutMin ?? null;
      const source = spec.currentHibernationTimeoutSource ?? "manual";
      if (remaining.length === 0) {
        // No pins left → governance returns to the manual baseline (the default).
        await write(agentId, {
          pins: remaining,
          current: baseline,
          source: "manual",
        });
      } else if (source === "pins") {
        // Pins still govern → recompute current from what remains.
        await write(agentId, {
          pins: remaining,
          current: currentFromPins(remaining, baseline),
        });
      } else {
        // Manual governs → drop the pin but leave current untouched.
        await write(agentId, { pins: remaining });
      }
    },

    async purge(agentId) {
      const spec = await readSpec(agentId);
      await write(agentId, {
        pins: [],
        current: spec.baseHibernationTimeoutMin ?? null,
        source: "manual",
      });
    },
  };
}
