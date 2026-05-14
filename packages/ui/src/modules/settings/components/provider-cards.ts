import type { ComponentType } from "react";

import type { ProviderPresetType, SecretView } from "../../../types.js";
import { AnthropicCard } from "./anthropic/card.js";
import { BobCard } from "./bob/card.js";
import { IbmLitellmCard } from "./ibm-litellm/card.js";
import { OpenAICard } from "./openai/card.js";

/**
 * UI counterpart to `PROVIDERS` (in api-server-api). Every provider
 * preset has exactly one entry here — the {@link ProvidersView} just
 * iterates `PROVIDER_PRESET_TYPES` and renders this map. Adding a
 * provider is one entry; the view doesn't grow.
 */
export const PROVIDER_CARDS = {
  anthropic: AnthropicCard,
  "ibm-litellm": IbmLitellmCard,
  openai: OpenAICard,
  bob: BobCard,
} satisfies Record<ProviderPresetType, ComponentType<{ secret?: SecretView }>>;
