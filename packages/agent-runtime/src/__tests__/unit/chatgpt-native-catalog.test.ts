// TEST_OVERVIEW: The runtime's native subscription catalog feeds managed sessions and reports only supported model choices; the Model Router must never resolve those choices as API-key requests. Router-only session settings are refused natively rather than ignored.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sessionSettingsError } from "agent-runtime-api";
import { createModelCatalog } from "../../modules/model-catalog/index.js";
import {
  loadManifest,
  harnessConfigBindingOf,
} from "../../modules/runtime-channel/manifest.js";
import {
  leaseEnvOf,
  type RuntimeEnvState,
} from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import { sessionSettingFrames } from "../../modules/acp/services/session-setting-frames.js";

const manifest = loadManifest(
  fileURLToPath(
    new URL(
      "../../../../agents/codex/rootfs/app/runtime-manifest.yaml",
      import.meta.url,
    ),
  ),
);
const binding = harnessConfigBindingOf(manifest)!;
const state: RuntimeEnvState = {
  env: {},
  harnesses: [],
  providers: [
    {
      id: "subscription",
      template: "openai-chatgpt",
      env: { PLATFORM_CODEX_AUTH_MODE: "chatgpt" },
    },
    {
      id: "ibm",
      template: "ibm-litellm",
      env: { OPENAI_API_KEY: "placeholder" },
    },
  ],
};

describe("native Codex subscription sessions", () => {
  // TEST_SCENARIO: Native choices are offered to Codex without querying an API model endpoint; the router cannot silently turn a subscription choice into a billed API call.
  it("lists native models for Codex and never resolves them through the router", async () => {
    const catalog = createModelCatalog({
      envState: () => ({ ...state, providers: state.providers.slice(0, 1) }),
      envReady: () => true,
      discover: async () => {
        throw new Error("no API discovery for native login");
      },
      harnesses: {
        codex: manifest.modelRouter,
        pi: { dialects: ["openai-responses"] },
      },
      table: {
        source: { url: "test", commit: "test", fetchedAt: "2026-11-04" },
        models: {},
      },
      log: () => {},
    });
    await catalog.refresh();
    expect(catalog.view("codex").providers[0]).toMatchObject({
      native: true,
      status: "listed",
    });
    expect(
      catalog.view("codex").providers[0]!.models.map((m) => m.name),
    ).toContain("openai/gpt-6.1-sol");
    expect(catalog.view("pi").providers[0]).toMatchObject({
      status: "unsupported",
      models: [],
    });
    expect(catalog.resolve("openai/gpt-6.1-sol", "codex")).toBeNull();
  });

  // TEST_SCENARIO: Selecting a subscription changes only that lease's provider env; another Codex session remains routed without inheriting the native login marker.
  it("keeps the subscription marker out of other provider leases", () => {
    expect(
      leaseEnvOf(state, { harness: "codex", provider: "subscription" }),
    ).toEqual({ PLATFORM_CODEX_AUTH_MODE: "chatgpt" });
    expect(leaseEnvOf(state, { harness: "codex", provider: "ibm" })).toEqual({
      OPENAI_API_KEY: "placeholder",
    });
    expect(leaseEnvOf(state, { harness: "codex", provider: null })).toEqual({});
  });

  // TEST_SCENARIO: Managed web and channel turns use qualified model names, but the native adapter must receive Codex's own model id before the prompt.
  it("delivers native and API model choices independently", () => {
    const input = {
      sessionId: "web-or-channel",
      settings: { effort: "high" },
      model: "openai/gpt-6.1-sol",
      harness: {
        catalog: binding.catalog,
        sessionSettings: binding.sessionSettings,
        sessionModelFrame: {
          configOption: "model",
          render: (model: string) => model,
        },
        configured: () => ({ mode: null, model: null }),
      },
    };
    expect(sessionSettingFrames({ ...input, native: true })[0]).toMatchObject({
      method: "session/set_config_option",
      critical: true,
      params: { configId: "model", value: "gpt-6.1-sol" },
    });
    expect(sessionSettingFrames({ ...input, native: false })[0]).toMatchObject({
      params: { value: "openai/gpt-6.1-sol" },
    });
  });

  // TEST_SCENARIO: Router-managed subagent model/effort have no native implementation, while normal model effort still reaches Codex.
  it("rejects router-only settings on native sessions and preserves API settings", () => {
    const settings = {
      subagentModel: "openai/gpt-6-luna",
      subagentEffort: "high",
    };
    expect(
      sessionSettingsError(
        binding.catalog,
        settings,
        "openai/gpt-6.1-sol",
        true,
      ),
    ).toContain("requires the Model Router");
    expect(
      sessionSettingsError(
        binding.catalog,
        settings,
        "openai/gpt-6.1-sol",
        false,
      ),
    ).toBeUndefined();
    expect(
      sessionSettingsError(
        binding.catalog,
        { effort: "high" },
        "openai/gpt-6.1-sol",
        true,
      ),
    ).toBeUndefined();
  });
});
