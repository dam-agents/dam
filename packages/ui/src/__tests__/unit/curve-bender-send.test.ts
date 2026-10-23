// TEST_OVERVIEW: The chat no longer holds a prompt for a missing provider or model. Before it sends, it takes the model the platform's preferred list names on the agent's attached providers, else the first model they list, and it attaches the install's shared CurveBender when the agent holds no provider at all. An install without that shared provider sends the prompt as it is, and leaves holding it to the composer's block.
import type { HarnessCatalogView } from "agent-runtime-api";
import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_WORK_MODEL,
  formatQualifiedModel,
  type ProviderAlias,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  CURVE_BENDER_ALIAS,
  sharedCurveBender,
} from "../../modules/sessions/lib/curve-bender.js";
import { sendPreparation } from "../../modules/sessions/lib/send-preparation.js";
import type { ProviderConnectionRef } from "../../modules/sessions/lib/session-pair-options.js";
import { topModelOf } from "../../modules/sessions/lib/top-model.js";

const shared: ProviderConnectionRef = {
  id: "cb",
  name: "CurveBender",
  type: "curve-bender",
  templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
};
const ownCurveBender: ProviderConnectionRef = {
  id: "cb-own",
  name: "CurveBender custom key",
  type: "curve-bender",
  templateId: "curve-bender",
};
const anthropic: ProviderConnectionRef = {
  id: "ant",
  name: "Anthropic",
  type: "anthropic",
  templateId: "anthropic",
};
const openai: ProviderConnectionRef = {
  id: "oai",
  name: "OpenAI",
  type: "openai",
  templateId: "openai",
};

const catalog = (
  providers: readonly {
    connectionId: string;
    alias: string;
    models: string[];
  }[],
): HarnessCatalogView => ({
  harness: "pi",
  routed: true,
  providers: providers.map((p) => ({
    connectionId: p.connectionId,
    alias: p.alias,
    template: p.alias,
    displayName: p.connectionId,
    status: "listed",
    listedAt: null,
    native: false,
    models: p.models.map((upstreamId) => ({
      name: formatQualifiedModel(p.alias as ProviderAlias, upstreamId),
      upstreamId,
      contextWindow: null,
      maxOutputTokens: null,
      reasoning: null,
      vision: null,
      prices: null,
      source: { limits: "none", prices: "none" },
    })),
  })),
});

const curveBenderCatalog = () =>
  catalog([
    {
      connectionId: "cb",
      alias: CURVE_BENDER_ALIAS,
      models: [
        "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "rits/meta-llama/Llama-4-70B",
      ],
    },
  ]);

const deepSeek = `cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017`;

describe("the model a send picks", () => {
  // TEST_SCENARIO: the preferred list's order beats the providers' own, so an agent holding Anthropic and OpenAI runs on the list's Claude over the provider listed first.
  it("takes the list's model across the attached providers", () => {
    const listed = catalog([
      { connectionId: "oai", alias: "openai", models: ["gpt-6.1-sol"] },
      { connectionId: "ant", alias: "anthropic", models: ["claude-opus-5-5"] },
    ]);
    expect(topModelOf(listed, [openai, anthropic])).toEqual({
      provider: "ant",
      model: "anthropic/claude-opus-5-5",
    });
  });

  // TEST_SCENARIO: a provider listing nothing the list names still gets the send out, on the first model it lists, which its listing orders newest first.
  it("falls back to the first listed model", () => {
    const listed = catalog([
      { connectionId: "oai", alias: "openai", models: ["llama-9", "llama-8"] },
    ]);
    expect(topModelOf(listed, [openai])).toEqual({
      provider: "oai",
      model: "openai/llama-9",
    });
  });

  // TEST_SCENARIO: a provider the agent does not hold is not a source, even when it lists the model the platform prefers.
  it("reads only the providers the agent holds", () => {
    const listed = catalog([
      {
        connectionId: "cb",
        alias: "cb",
        models: ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"],
      },
      { connectionId: "ant", alias: "anthropic", models: ["claude-opus-5-5"] },
    ]);
    expect(topModelOf(listed, [anthropic])).toEqual({
      provider: "ant",
      model: "anthropic/claude-opus-5-5",
    });
  });

  it("picks nothing without a listing", () => {
    expect(topModelOf(undefined, [openai])).toBeNull();
  });
});

describe("the pair a send prepares", () => {
  const base = {
    session: null,
    harness: "pi",
    pair: null,
    granted: [] as ProviderConnectionRef[],
    owned: [shared],
    catalog: curveBenderCatalog(),
  };

  // TEST_SCENARIO: an agent holding no provider gets the install's shared CurveBender attached, and the send runs on the deployment's DeepSeek model.
  it("attaches the shared CurveBender and selects DeepSeek", () => {
    expect(sendPreparation(base)).toEqual({
      attach: "cb",
      pair: { harness: "pi", provider: "cb", model: deepSeek },
      model: null,
    });
  });

  // TEST_SCENARIO: the attach happens before the pod has listed the provider, so the pair names the deployment's work model directly.
  it("names the work model when the provider has not listed yet", () => {
    expect(sendPreparation({ ...base, catalog: undefined })).toEqual({
      attach: "cb",
      pair: {
        harness: "pi",
        provider: "cb",
        model: formatQualifiedModel(
          CURVE_BENDER_ALIAS,
          CURVE_BENDER_WORK_MODEL,
        ),
      },
      model: null,
    });
  });

  // TEST_SCENARIO: an install without the shared provider has nothing to attach, so the prompt goes out as it is, and the composer's own block is what holds a send that needs a provider.
  it("sends as it is when there is nothing to attach", () => {
    const asIs = { attach: null, pair: null, model: null };
    expect(sendPreparation({ ...base, owned: [openai] })).toEqual(asIs);
    expect(sendPreparation({ ...base, owned: [] })).toEqual(asIs);
  });

  // TEST_SCENARIO: an agent whose harness brings its own model, as the mock harness does, holds no provider and lists nothing; its prompt still goes out rather than back into the composer.
  it("sends to an agent with no provider and no listing", () => {
    expect(
      sendPreparation({
        ...base,
        harness: "mock",
        owned: [],
        catalog: undefined,
      }),
    ).toEqual({ attach: null, pair: null, model: null });
  });

  // TEST_SCENARIO: an agent that already holds a provider keeps it, and the send takes the preferred model on it.
  it("selects the preferred model on a provider the agent holds", () => {
    expect(
      sendPreparation({
        ...base,
        pair: { harness: "pi", provider: "cb", model: null },
        granted: [shared],
      }),
    ).toEqual({
      attach: null,
      pair: { harness: "pi", provider: "cb", model: deepSeek },
      model: null,
    });
  });

  // TEST_SCENARIO: a pair that already names a model is sent as it is.
  it("keeps a pair that names a model", () => {
    expect(
      sendPreparation({
        ...base,
        pair: {
          harness: "claude-code",
          provider: "ant",
          model: "anthropic/opus",
        },
        granted: [anthropic],
      }),
    ).toEqual({ attach: null, pair: null, model: null });
  });

  // TEST_SCENARIO: a provider that has not listed yet, as a sleeping agent's has not, still leaves the send a model when it is CurveBender, whose deployment work model the platform knows.
  it("pins the work model on CurveBender when nothing is listed", () => {
    expect(
      sendPreparation({
        ...base,
        session: { harness: "pi", model: null },
        granted: [shared],
        catalog: undefined,
      }),
    ).toEqual({
      attach: null,
      pair: null,
      model: formatQualifiedModel(CURVE_BENDER_ALIAS, CURVE_BENDER_WORK_MODEL),
    });
  });

  // TEST_SCENARIO: a session with no model takes the preferred one on the session's own harness before the prompt goes out.
  it("selects a model for an open session that has none", () => {
    expect(
      sendPreparation({
        ...base,
        session: { harness: "pi", model: null },
        granted: [shared],
      }),
    ).toEqual({ attach: null, pair: null, model: deepSeek });
  });

  // TEST_SCENARIO: a session already running on a model is left alone.
  it("leaves an open session on its model", () => {
    expect(
      sendPreparation({
        ...base,
        session: { harness: "pi", model: deepSeek },
        granted: [shared],
      }),
    ).toEqual({ attach: null, pair: null, model: null });
  });
});

describe("the shared CurveBender in the composer", () => {
  // TEST_SCENARIO: the alert and the auto-attach only act on the deployment's provider, never on the one a user keyed themselves.
  it("finds the deployment's provider among the owner's connections", () => {
    expect(sharedCurveBender([ownCurveBender, shared])).toEqual(shared);
    expect(sharedCurveBender([ownCurveBender])).toBeUndefined();
  });
});
