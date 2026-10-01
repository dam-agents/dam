import { describe, expect, it } from "vitest";
import { createModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";

const noop = () => {};

function stubFetch(opts: {
  body?: unknown;
  ok?: boolean;
  status?: number;
  throws?: boolean;
}): { fetchImpl: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    urls.push(String(url));
    if (opts.throws) throw new Error("network down");
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => opts.body,
    } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, urls };
}

describe("createModelDiscovery", () => {
  it("reports not-configured when no spec is declared", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "m" }] } });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover(undefined, { OPENAI_PROXY_URL: "https://x" }),
    ).toEqual({ status: "not-configured" });
    expect(urls).toEqual([]);
  });

  it("reports unavailable when no candidate env var is set (no fetch)", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "m" }] } });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover({ urlEnv: ["OPENAI_PROXY_URL", "RITS_URL"] }, {}),
    ).toEqual({ status: "unavailable" });
    expect(urls).toEqual([]);
  });

  it("uses the first set candidate and normalizes the base to /v1/models", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "gpt" }] } });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    await discover(
      { urlEnv: ["MISSING", "OPENAI_PROXY_URL"] },
      { OPENAI_PROXY_URL: "https://proxy.example.com/" },
    );
    expect(urls).toEqual(["https://proxy.example.com/v1/models"]);
  });

  it("does not double-append /v1 when the base already has a version segment", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "gpt" }] } });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    await discover({ urlEnv: ["U"] }, { U: "https://proxy/v1" });
    expect(urls).toEqual(["https://proxy/v1/models"]);
  });

  it("maps ids to choices, filters embeddings, dedups and sorts", async () => {
    const { fetchImpl } = stubFetch({
      body: {
        data: [
          { id: "b-model" },
          { id: "a-model" },
          { id: "a-model" },
          { id: "text-embedding-3-small" },
          { id: "Some-Embedding-v2" },
          { id: 123 },
          null,
        ],
      },
    });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toEqual({
      status: "observed",
      models: [
        { value: "a-model", name: "a-model" },
        { value: "b-model", name: "b-model" },
      ],
      via: "U",
    });
  });

  it("reports unavailable when the body's data is not an array", async () => {
    const { fetchImpl } = stubFetch({ body: { data: "nope" } });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toEqual({
      status: "unavailable",
    });
  });

  // TEST_SCENARIO: a listing with nothing usable in it is reported as unavailable, not as an empty list, so a provider having a bad moment leaves the last known models in place instead of erasing them.
  it("reports unavailable when the listing holds no usable model", async () => {
    const { fetchImpl } = stubFetch({
      body: { data: [{ id: "text-embedding-3-large" }] },
    });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toEqual({
      status: "unavailable",
    });
  });

  // TEST_SCENARIO: Bob's list comes from a LiteLLM model-information route under its own inference prefix, so discovery must ask an exact path and read model names rather than OpenAI ids.
  it("asks the declared path and reads a LiteLLM listing", async () => {
    const { fetchImpl, urls } = stubFetch({
      body: {
        data: [
          {
            model_name: "aws/claude-opus-4-8",
            model_info: { max_tokens: 8192 },
          },
          { model_name: "aws/claude-sonnet-4-6" },
          { id: "ignored-openai-id" },
        ],
      },
    });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover(
        {
          urlEnv: ["BOB_GATEWAY_URL"],
          path: "/inference/v1/model/info",
          shape: "litellm-model-info",
        },
        { BOB_GATEWAY_URL: "https://gateway.example.com/" },
      ),
    ).toEqual({
      status: "observed",
      via: "BOB_GATEWAY_URL",
      models: [
        { value: "aws/claude-opus-4-8", name: "aws/claude-opus-4-8" },
        { value: "aws/claude-sonnet-4-6", name: "aws/claude-sonnet-4-6" },
      ],
    });
    expect(urls).toEqual([
      "https://gateway.example.com/inference/v1/model/info",
    ]);
  });

  // TEST_SCENARIO: a LiteLLM gateway lists every deployment it fronts, so an entry the provider marks as anything but conversational must stay out of the model list no matter what its alias is called.
  it("keeps only the conversational entries of a LiteLLM listing", async () => {
    const { fetchImpl } = stubFetch({
      body: {
        data: [
          { model_name: "premium-ide", model_info: { mode: "chat" } },
          { model_name: "bge-large", model_info: { mode: "embedding" } },
          { model_name: "rank-v3", model_info: { mode: "rerank" } },
          { model_name: "legacy-no-mode" },
        ],
      },
    });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover(
        { urlEnv: ["U"], shape: "litellm-model-info" },
        { U: "https://p" },
      ),
    ).toEqual({
      status: "observed",
      via: "U",
      models: [
        { value: "legacy-no-mode", name: "legacy-no-mode" },
        { value: "premium-ide", name: "premium-ide" },
      ],
    });
  });

  it("reports unavailable on a non-2xx response", async () => {
    const { fetchImpl } = stubFetch({ ok: false, status: 502, body: {} });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toEqual({
      status: "unavailable",
    });
  });

  it("reports unavailable (never throws) when fetch fails", async () => {
    const { fetchImpl } = stubFetch({ throws: true });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    await expect(
      discover({ urlEnv: ["U"] }, { U: "https://p" }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  /**
   * TEST_SCENARIO: Bedrock lists inference profiles rather than models. Only
   * an ACTIVE profile is invocable, so anything else is left out, and the
   * request goes to the declared listing path on the control-plane endpoint.
   */
  it("reads a Bedrock inference-profile listing, keeping only active profiles", async () => {
    const { fetchImpl, urls } = stubFetch({
      body: {
        inferenceProfileSummaries: [
          {
            inferenceProfileId: "eu.anthropic.claude-sonnet-4-6",
            status: "ACTIVE",
          },
          {
            inferenceProfileId: "eu.anthropic.claude-opus-4-8",
            status: "INACTIVE",
          },
          { inferenceProfileId: "eu.amazon.nova-pro-v1:0", status: "ACTIVE" },
          { status: "ACTIVE" },
        ],
      },
    });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover(
        {
          urlEnv: ["AWS_ENDPOINT_URL_BEDROCK"],
          path: "/inference-profiles?maxResults=1000",
          shape: "bedrock-inference-profiles",
        },
        {
          AWS_ENDPOINT_URL_BEDROCK:
            "https://bedrock.eu-central-1.amazonaws.com",
        },
      ),
    ).toEqual({
      status: "observed",
      via: "AWS_ENDPOINT_URL_BEDROCK",
      models: [
        { value: "eu.amazon.nova-pro-v1:0", name: "eu.amazon.nova-pro-v1:0" },
        {
          value: "eu.anthropic.claude-sonnet-4-6",
          name: "eu.anthropic.claude-sonnet-4-6",
        },
      ],
    });
    expect(urls).toEqual([
      "https://bedrock.eu-central-1.amazonaws.com/inference-profiles?maxResults=1000",
    ]);
  });

  /**
   * TEST_SCENARIO: A manifest can declare several sources, one per provider
   * dialect. The first whose variable the agent was granted answers, in that
   * source's own dialect.
   */
  it("asks the first declared source whose variable is set", async () => {
    const { fetchImpl, urls } = stubFetch({
      body: {
        inferenceProfileSummaries: [
          { inferenceProfileId: "p", status: "ACTIVE" },
        ],
      },
    });
    const discover = createModelDiscovery({ log: noop, fetchImpl });
    const outcome = await discover(
      [
        { urlEnv: ["OPENAI_BASE_URL"] },
        { urlEnv: ["BEDROCK_URL"], shape: "bedrock-inference-profiles" },
      ],
      { BEDROCK_URL: "https://bedrock" },
    );
    expect(outcome).toMatchObject({ status: "observed", via: "BEDROCK_URL" });
    expect(urls).toEqual(["https://bedrock/v1/models"]);
  });
});
