import type { HarnessConfigChoice } from "../runtime/types.js";

// The harness's current config values, read back from its own config file.
// `null` means the key is unset (harness uses its built-in default).
export interface HarnessConfigCurrent {
  model: string | null;
  mode: string | null;
  configOptions: Record<string, string>;
  // Models discovered live when the manifest declares a `modelDiscovery` source, else null.
  availableModels: HarnessConfigChoice[] | null;
}

export interface HarnessConfigService {
  readCurrent: () => Promise<HarnessConfigCurrent>;
}
