// TEST_OVERVIEW: A ChatGPT Connection enables native Codex without a platform-held token. Its distinct model alias preserves subscription billing when OpenAI API-key connections change or coexist.
import { describe, expect, it } from "vitest";
import {
  harnessFits,
  OPENAI_CHATGPT_TEMPLATE_ID,
  providerAliasConflict,
  templateIdForProvider,
  type HarnessCatalog,
} from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createProviderModelCatalog } from "../../modules/connections/services/provider-model-catalog.js";
import { loadShippedHarnessFacts } from "../../modules/connections/infrastructure/shipped-harness-manifests.js";
import {
  newConnectionsStore,
  serviceHarness,
  memorySecretStore,
} from "../helpers/connections-service.js";

const harnesses: HarnessCatalog = {
  default: "codex",
  harnesses: (["codex", "pi", "claude-code"] as const).map((name) => ({
    name,
    displayName: name,
    providers: name === "codex" ? ["openai", "chatgpt"] : ["openai"],
    tags: [],
    experimental: false,
  })),
  telemetryEnv: () => [],
};

describe("ChatGPT subscription Connection", () => {
  // TEST_SCENARIO: Enabling the provider must not ask for a secret, invoke OAuth infrastructure or write an empty credential into the gateway.
  it("creates a native mode with network access and no platform-held credentials", async () => {
    const store = newConnectionsStore();
    const { svc, secretReads } = serviceHarness({
      store,
      templates: createConnectionTemplateRegistry(buildCatalog()),
      brandName: "Test",
    });
    const id = await svc.createFromTemplate({
      templateId: OPENAI_CHATGPT_TEMPLATE_ID,
      name: "My subscription",
      authKind: "none",
    });
    const saved = store.rows.get(id)!;
    expect(saved.auth).toEqual({ kind: "none" });
    expect(saved.contributions).toEqual([
      { kind: "env", name: "PLATFORM_CODEX_AUTH_MODE", placeholder: "chatgpt" },
      { kind: "egress-allow", host: "auth.openai.com" },
      { kind: "egress-allow", host: "chatgpt.com" },
      { kind: "egress-allow", host: "api.openai.com" },
    ]);
    expect(store.secrets.size).toBe(0);
    expect(secretReads).toEqual({ get: 0, getField: 0 });

    const discover = async () => {
      throw new Error("native models must not use the API-key model listing");
    };
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(store.secrets),
      discover,
      shipped: loadShippedHarnessFacts(),
    });
    const owner = await catalog.read([saved], harnesses);
    expect(owner.providers[0]).toMatchObject({
      template: OPENAI_CHATGPT_TEMPLATE_ID,
      harnesses: ["codex"],
      status: "listed",
    });
    expect(owner.providers[0]!.models.map((m) => m.name)).toEqual([
      "chatgpt/gpt-6.1-sol",
      "chatgpt/gpt-6-astra",
      "chatgpt/gpt-6-luna",
    ]);
    expect(owner.providers[0]!.models.every((m) => m.prices === null)).toBe(
      true,
    );
    expect(
      owner.harnesses.find((h) => h.name === "codex")?.nativeTemplates,
    ).toContain(OPENAI_CHATGPT_TEMPLATE_ID);
  });

  // TEST_SCENARIO: A subscription belongs to Codex's native login, while an API key still works for other compatible harnesses and remains the default API credential mode.
  it("restricts subscriptions to Codex and preserves API-key compatibility", () => {
    expect(
      harnessFits(harnesses, "codex", "chatgpt", OPENAI_CHATGPT_TEMPLATE_ID),
    ).toBe(true);
    expect(
      harnessFits(harnesses, "pi", "chatgpt", OPENAI_CHATGPT_TEMPLATE_ID),
    ).toBe(false);
    expect(
      harnessFits(
        harnesses,
        "claude-code",
        "chatgpt",
        OPENAI_CHATGPT_TEMPLATE_ID,
      ),
    ).toBe(false);
    expect(harnessFits(harnesses, "pi", "openai", "openai")).toBe(true);
    expect(templateIdForProvider("openai", "sk-test-only")).toBe("openai");
    expect(
      providerAliasConflict(
        [{ id: "api", name: "API", templateId: "openai" }],
        {
          id: "subscription",
          name: "Subscription",
          templateId: OPENAI_CHATGPT_TEMPLATE_ID,
        },
      ),
    ).toBeNull();
  });
});
