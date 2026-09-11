import {
  type HarnessFamily,
  type ProviderPresetType,
  providersForHarness,
} from "api-server-api";

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
  "starter-kit": EVERY_PROVIDER,
  experiment: { allow: CLAUDE_ONLY_PROVIDERS, recommended: "ibm-litellm" },
};

export function setupProviderPolicy(flow: SetupFlow): SetupProviderPolicy {
  return POLICY_BY_FLOW[flow];
}

export function narrowPolicyToHarness(
  policy: SetupProviderPolicy,
  harness: HarnessFamily | undefined,
): SetupProviderPolicy {
  const compatible = providersForHarness(harness);
  const allow = (policy.allow ?? compatible).filter((p) =>
    compatible.includes(p),
  );
  const recommended =
    policy.recommended && allow.includes(policy.recommended)
      ? policy.recommended
      : allow[0];
  return { allow, recommended };
}
