import type { ProviderPresetType } from "../connections/providers.js";
import type { HarnessFamily } from "./types.js";

export const ALL_PROVIDER_TYPES: readonly ProviderPresetType[] = [
  "ibm-litellm",
  "anthropic",
  "openai",
  "bob",
];

export const PROVIDERS_BY_HARNESS: Record<
  HarnessFamily,
  readonly ProviderPresetType[]
> = {
  "claude-code": ["ibm-litellm", "anthropic"],
  codex: ["ibm-litellm", "openai"],
  pi: ["ibm-litellm", "anthropic", "openai"],
  bob: ["ibm-litellm", "bob"],
};

export function providersForHarness(
  harness: HarnessFamily | undefined,
): readonly ProviderPresetType[] {
  return harness ? PROVIDERS_BY_HARNESS[harness] : ALL_PROVIDER_TYPES;
}
