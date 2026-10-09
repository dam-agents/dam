import type {
  HarnessCapability,
  HarnessConfigCatalog,
} from "agent-runtime-api";
import type { z } from "zod";
import type {
  harnessConfigSnapshotResultSchema,
  harnessConfigSnapshotSchema,
  sessionPairSchema,
} from "./schemas.js";

export type SessionPair = z.infer<typeof sessionPairSchema>;

export interface HarnessConfigChange {
  harness?: string;
  model?: string;
  mode?: string;
  configOptions?: Record<string, string>;
  unset?: string[];
}

export interface HarnessConfigStatus {
  supported: boolean;
  catalog: HarnessConfigCatalog | null;
  sessionModel: boolean;
  defaultHarness: string | null;
  harnesses: HarnessCapability[] | null;
}

export interface HarnessConfigSettled {
  settled: boolean;
}

export type HarnessConfigSnapshot = z.infer<typeof harnessConfigSnapshotSchema>;

export type HarnessConfigSnapshotPatch = Partial<
  Omit<HarnessConfigSnapshot, "capturedAt" | "confirmed" | "harnesses">
>;

export type HarnessConfigSnapshotResult = z.infer<
  typeof harnessConfigSnapshotResultSchema
>;

export interface HarnessConfigService {
  apply(agentId: string, change: HarnessConfigChange): Promise<void>;
  status(agentId: string): Promise<HarnessConfigStatus>;
  settled(agentId: string): Promise<HarnessConfigSettled>;
  snapshot(
    agentId: string,
    harness?: string,
  ): Promise<HarnessConfigSnapshotResult>;
  sessionPair(agentId: string): Promise<SessionPair | null>;
  rememberSessionPair(agentId: string, pair: SessionPair): Promise<void>;
}
