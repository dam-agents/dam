/**
 * TEST_OVERVIEW: what the Model Router's `/v1/models` answers a harness with
 * no modelRouter section, such as a kit image's own: every model the agent's
 * providers list, in the order it is served, so the platform's preferred
 * work model is the first entry even when it sits on a later provider; and a
 * harness name that is only an inherited object key is not taken as bound.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import { forHarness } from "../../modules/model-catalog/index.js";
import {
  composeModelRouter,
  HARNESS_HEADER,
  type ModelRouter,
} from "../../modules/model-router/index.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

const metadata: ModelMetadata = {
  contextWindow: 200_000,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  prices: null,
  cacheControl: null,
  thinkingFormat: null,
  source: { limits: "table", prices: "table" },
};

const provider = (
  alias: "ibm" | "cb",
  upstreamIds: readonly string[],
): CatalogProvider => {
  const template = alias === "ibm" ? "ibm-litellm" : "curve-bender";
  const dialects = [
    "anthropic-messages",
    "openai-chat",
    "openai-responses",
  ] as const;
  return {
    alias,
    connectionId: `conn-${alias}`,
    template,
    displayName: alias.toUpperCase(),
    dialects,
    status: "listed",
    listedAt: null,
    entries: upstreamIds.map((upstreamId): CatalogEntry => ({
      name: `${alias}/${upstreamId}`,
      alias,
      connectionId: `conn-${alias}`,
      template,
      upstreamId,
      dialects,
      metadata,
    })),
  };
};

const providers = [
  provider("ibm", ["azure/gpt-5.5", "rits/zai-org/glm-5-1"]),
  provider("cb", [
    "aws/claude-opus-5-5",
    "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  ]),
];
const HARNESSES: Record<string, ModelRouterBinding> = {
  pi: { dialects: ["openai-chat"] },
};

let router: ModelRouter;

beforeAll(async () => {
  router = composeModelRouter({
    catalog: {
      providers: () => providers,
      forHarness: (harness) =>
        forHarness(
          providers.flatMap((p) => p.entries),
          harness,
          HARNESSES[harness],
        ),
    },
    envState: () => ({ env: {}, harnesses: [], providers: [] }),
    harnesses: HARNESSES,
    defaultHarness: "image-agent",
    port: 0,
    log: () => {},
  });
  await router.listen();
});

afterAll(async () => {
  await router.close();
});

const ids = async (harness?: string): Promise<string[]> => {
  const r = await fetch(`${router.baseUrl}/v1/models`, {
    headers: harness ? { [HARNESS_HEADER]: harness } : {},
  });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { data: { id: string }[] };
  return body.data.map((m) => m.id);
};

describe("the model list of a harness with no modelRouter section", () => {
  /** TEST_SCENARIO: A harness this image carries on its own names no models
   * of its own, so the platform's preferred work model for it is DeepSeek
   * V4.1 Flash; it is on CurveBender, listed after IBM, and still comes
   * first, because the list keeps its own order rather than putting a home
   * provider first, and a harness that takes the first entry runs on the
   * platform's pick. A request that names no harness is the image's own
   * harness, the default one. */
  it("serves the preferred work model first, from a later provider", async () => {
    expect(await ids("image-agent")).toEqual([
      "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "ibm/azure/gpt-5.5",
      "ibm/rits/zai-org/glm-5-1",
      "cb/aws/claude-opus-5-5",
    ]);
    expect((await ids())[0]).toBe(
      "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    );
  });

  /** TEST_SCENARIO: A harness name that is only a key of every object, such
   * as `constructor`, names no binding, so it gets the unbound list instead
   * of failing on a binding that is not one. */
  it("takes an inherited object key for an unbound harness", async () => {
    expect((await ids("constructor"))[0]).toBe(
      "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    );
  });

  /** TEST_SCENARIO: A harness with a binding keeps its own list in its usual
   * order. */
  it("keeps a bound harness's own list", async () => {
    expect(await ids("pi")).toEqual([
      "ibm/azure/gpt-5.5",
      "ibm/rits/zai-org/glm-5-1",
      "cb/aws/claude-opus-5-5",
      "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    ]);
  });
});
