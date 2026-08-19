import type { ProviderPresetType } from "api-server-api";

import type { SetupFlow } from "../hooks/use-setup-form.js";

const KINDED_PROVIDERS: readonly ProviderPresetType[] = [
  "ibm-litellm",
  "anthropic",
];

export function setupProviderPolicy(flow: SetupFlow): {
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
} {
  if (flow === "coding-agent") return { recommended: "ibm-litellm" };
  return { allow: KINDED_PROVIDERS, recommended: "ibm-litellm" };
}
