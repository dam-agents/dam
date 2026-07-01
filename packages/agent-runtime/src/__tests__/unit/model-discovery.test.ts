import { describe, expect, it } from "vitest";
import { createOpenAiModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";

const noop = () => {};

/** A stub `fetch` that records requested URLs and returns a canned response. */
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

describe("createOpenAiModelDiscovery", () => {
  it("returns null when no spec is declared", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "m" }] } });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover(undefined, { OPENAI_PROXY_URL: "https://x" }),
    ).toBeNull();
    expect(urls).toEqual([]);
  });

  it("returns null when no candidate env var is set (no fetch)", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "m" }] } });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    expect(
      await discover({ urlEnv: ["OPENAI_PROXY_URL", "RITS_URL"] }, {}),
    ).toBeNull();
    expect(urls).toEqual([]);
  });

  it("uses the first set candidate and normalizes the base to /v1/models", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "gpt" }] } });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    await discover(
      { urlEnv: ["MISSING", "OPENAI_PROXY_URL"] },
      { OPENAI_PROXY_URL: "https://proxy.example.com/" },
    );
    expect(urls).toEqual(["https://proxy.example.com/v1/models"]);
  });

  it("does not double-append /v1 when the base already has a version segment", async () => {
    const { fetchImpl, urls } = stubFetch({ body: { data: [{ id: "gpt" }] } });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
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
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toEqual([
      { value: "a-model", name: "a-model" },
      { value: "b-model", name: "b-model" },
    ]);
  });

  it("returns null when the body's data is not an array", async () => {
    const { fetchImpl } = stubFetch({ body: { data: "nope" } });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toBeNull();
  });

  it("returns null when the list is empty after filtering embeddings", async () => {
    const { fetchImpl } = stubFetch({
      body: { data: [{ id: "text-embedding-3-large" }] },
    });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    const { fetchImpl } = stubFetch({ ok: false, status: 502, body: {} });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    expect(await discover({ urlEnv: ["U"] }, { U: "https://p" })).toBeNull();
  });

  it("returns null (never throws) when fetch fails", async () => {
    const { fetchImpl } = stubFetch({ throws: true });
    const discover = createOpenAiModelDiscovery({ log: noop, fetchImpl });
    await expect(
      discover({ urlEnv: ["U"] }, { U: "https://p" }),
    ).resolves.toBeNull();
  });
});
