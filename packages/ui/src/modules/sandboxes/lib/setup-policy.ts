import type { ProviderPresetType } from "api-server-api";

import type { SetupFlow } from "../hooks/use-setup-form.js";

export interface SetupProviderPolicy {
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
}

const EVERY_PROVIDER: SetupProviderPolicy = { recommended: "ibm-litellm" };

const POLICY_BY_FLOW: Record<SetupFlow, SetupProviderPolicy> = {
  "coding-agent": EVERY_PROVIDER,
  "starter-kit": EVERY_PROVIDER,
};

export function setupProviderPolicy(flow: SetupFlow): SetupProviderPolicy {
  return POLICY_BY_FLOW[flow];
}

export function narrowPolicyToTemplate(
  policy: SetupProviderPolicy,
  template: { providers?: readonly ProviderPresetType[] } | null | undefined,
): SetupProviderPolicy {
  const compatible = template?.providers;
  if (!compatible) return policy;
  const allow = (policy.allow ?? compatible).filter((p) =>
    compatible.includes(p),
  );
  const recommended =
    policy.recommended && allow.includes(policy.recommended)
      ? policy.recommended
      : allow[0];
  return { allow, recommended };
}
