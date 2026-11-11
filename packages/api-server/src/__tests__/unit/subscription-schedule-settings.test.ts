// TEST_OVERVIEW: A schedule checks router-only settings against the resolved provider, including inherited models and grants whose legacy view omits its template.
import { describe, expect, it } from "vitest";
import type { HarnessCatalog, OwnerModelCatalogView } from "api-server-api";
import {
  harnessCapabilityOf,
  loadShippedHarnessFacts,
} from "../../modules/connections/infrastructure/shipped-harness-manifests.js";
import { createSessionChoicesValidator } from "../../modules/harness-config/services/session-choices.js";

const capability = harnessCapabilityOf(loadShippedHarnessFacts().codex!);
function validator(native: boolean, model: string | null) {
  const template = native ? "openai-chatgpt" : "openai";
  return createSessionChoicesValidator({
    catalog: {
      default: "codex",
      harnesses: [
        {
          name: "codex",
          displayName: "Codex",
          providers: ["openai", "chatgpt"],
          tags: [],
          experimental: false,
        },
      ],
      telemetryEnv: () => [],
    } as HarnessCatalog,
    pairRepo: {
      read: async () => null,
      grantedProviders: async () => [
        {
          id: "provider",
          type: native ? ("chatgpt" as const) : ("openai" as const),
        },
      ],
    },
    snapshotRepo: { read: async () => null },
    getCapabilities: async () => ({
      modelRouter: true,
      defaultHarness: "codex",
      harnesses: [capability],
    }),
    ownerCatalog: async () =>
      ({
        providers: [{ connectionId: "provider", template, models: [] }],
      }) as unknown as Pick<OwnerModelCatalogView, "providers">,
    firePair: async () => ({ harness: "codex", provider: "provider", model }),
  });
}

describe("native schedule settings", () => {
  // TEST_SCENARIO: A native provider cannot implement a router-only setting even when the model is inherited or its grant omits the template. The owner's provider catalog defines its authentication path.
  it.each([null, "chatgpt/gpt-6.1-sol"])(
    "rejects router-only settings for resolved native model %s",
    async (model) => {
      await expect(
        validator(true, model)("agent", {
          settings: { subagentEffort: "high" },
        }),
      ).resolves.toMatch(/requires the Model Router/);
      await expect(
        validator(true, model)("agent", { settings: { effort: "high" } }),
      ).resolves.toBeUndefined();
    },
  );

  // TEST_SCENARIO: The API Connection still supports its router setting; adding native validation must not block it.
  it("retains router-only settings on API schedules", async () => {
    await expect(
      validator(false, "openai/gpt-6.1-sol")("agent", {
        settings: { subagentEffort: "high" },
      }),
    ).resolves.toBeUndefined();
  });
});
