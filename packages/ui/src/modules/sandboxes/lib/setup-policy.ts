import type { ProviderPresetType } from "api-server-api";

import type { SetupFlow } from "../hooks/use-setup-form.js";

export interface SetupProviderPolicy {
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
}

const CLAUDE_ONLY_PROVIDERS: readonly ProviderPresetType[] = [
  "ibm-litellm",
  "anthropic",
];

const EVERY_PROVIDER: SetupProviderPolicy = { recommended: "ibm-litellm" };

const POLICY_BY_FLOW: Record<SetupFlow, SetupProviderPolicy> = {
  "coding-agent": EVERY_PROVIDER,
  "knowledge-base": EVERY_PROVIDER,
  experiment: { allow: CLAUDE_ONLY_PROVIDERS, recommended: "ibm-litellm" },
};

export function setupProviderPolicy(flow: SetupFlow): SetupProviderPolicy {
  return POLICY_BY_FLOW[flow];
}
