import type { HarnessConfigCatalog } from "agent-runtime-api";
import type { z } from "zod";
import type {
  harnessConfigSnapshotResultSchema,
  harnessConfigSnapshotSchema,
} from "./schemas.js";

// A one-shot change to an agent's harness config. `unset` lists fields to clear.
// Applied once via a `harness-config` event, never reconciled.
export interface HarnessConfigChange {
  model?: string;
  mode?: string;
  configOptions?: Record<string, string>;
  unset?: string[];
}

export interface HarnessConfigStatus {
  supported: boolean;
  catalog: HarnessConfigCatalog | null;
}

export interface HarnessConfigSettled {
  settled: boolean;
}

export type HarnessConfigSnapshot = z.infer<typeof harnessConfigSnapshotSchema>;

/** The fields a snapshot write may carry. `capturedAt` and `confirmed` are the
 *  writer's to stamp, so they aren't patchable. */
export type HarnessConfigSnapshotPatch = Partial<
  Omit<HarnessConfigSnapshot, "capturedAt" | "confirmed">
>;

export type HarnessConfigSnapshotResult = z.infer<
  typeof harnessConfigSnapshotResultSchema
>;

export interface HarnessConfigService {
  apply(agentId: string, change: HarnessConfigChange): Promise<void>;
  status(agentId: string): Promise<HarnessConfigStatus>;
  settled(agentId: string): Promise<HarnessConfigSettled>;
  snapshot(agentId: string): Promise<HarnessConfigSnapshotResult>;
}
