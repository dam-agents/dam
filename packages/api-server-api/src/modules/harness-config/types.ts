import type { HarnessConfigCatalog } from "agent-runtime-api";

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

export interface HarnessConfigService {
  apply(agentId: string, change: HarnessConfigChange): Promise<void>;
  status(agentId: string): Promise<HarnessConfigStatus>;
  settled(agentId: string): Promise<HarnessConfigSettled>;
}
