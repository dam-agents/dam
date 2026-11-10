import {
  type Connection,
  createModelDiscovery,
  CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
  type HarnessCatalog,
  type HarnessView,
  type PriceTable,
} from "api-server-api";
import { describe, expect, it } from "vitest";
import {
  memorySecretStore,
  type StoredSecret,
} from "../helpers/connections-service.js";
import { createProviderModelCatalog } from "../../modules/connections/services/provider-model-catalog.js";

/**
 * TEST_OVERVIEW: the owner catalog lists a CurveBender Connection through the
 * IBM Cloud Gateway from its project endpoint's OpenAI model list, with the
 * stored gateway key as a bearer token, and offers its models to the chat
 * harnesses the harness catalog assigns it. A listing the gateway refuses or
 * cannot answer reads as unavailable, which the picker shows as a failed
 * listing, never as a provider with no models.
 */

const ENDPOINT = "https://us-east.rhai.ibm.com/v1/projects/p-1/inference";
const SECRET_PATH = "connection:curve-bender-cloud-gateway";

const harness = (
  name: HarnessView["name"],
  providers: HarnessView["providers"],
): HarnessView => ({
  name,
  displayName: name,
  providers,
  tags: [],
  experimental: false,
});

const harnesses: Pick<HarnessCatalog, "default" | "harnesses"> = {
  default: "pi",
  harnesses: [
    harness("claude-code", ["curve-bender"]),
    harness("pi", ["curve-bender", "curve-bender-cloud-gateway"]),
  ],
};

const table: PriceTable = {
  source: { url: "test", commit: "test", fetchedAt: "2026-11-10" },
  models: {},
};

const gateway: Connection = {
  id: "conn-gw",
  ownerId: "owner",
  templateId: CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
  name: "gateway",
  inputs: {},
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: SECRET_PATH, field: "" },
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
  contributions: [
    { kind: "env", name: "OPENAI_API_KEY", placeholder: "dummy-placeholder" },
    { kind: "env", name: "OPENAI_BASE_URL", placeholder: ENDPOINT },
  ],
};

function catalogAnswering(res: () => Response) {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return res();
  };
  const secrets = new Map<string, StoredSecret>([
    [
      SECRET_PATH,
      {
        fields: { "": "gw-key" },
        annotations: {},
        purpose: SECRET_PATH,
      },
    ],
  ]);
  const catalog = createProviderModelCatalog({
    secretStore: memorySecretStore(secrets),
    discover: createModelDiscovery({ log: () => {}, fetchImpl }),
    table,
    shipped: {},
  });
  return { catalog, calls };
}

describe("the owner catalog of an IBM Cloud Gateway Connection", () => {
  // TEST_SCENARIO: the project's model list answers, so its models are offered under the gateway's alias to the chat harness the catalog assigns it, and not to Claude Code, which the gateway does not serve.
  it("lists the project's models for the harnesses it serves", async () => {
    const { catalog, calls } = catalogAnswering(
      () =>
        new Response(
          JSON.stringify({
            data: [{ id: "zai-org/GLM-5.3" }, { id: "deepseek-v4.1-flash" }],
          }),
          { status: 200 },
        ),
    );
    const view = await catalog.read([gateway], harnesses);

    expect(calls[0]).toEqual({
      url: `${ENDPOINT}/models`,
      authorization: "Bearer gw-key",
    });
    expect(view.providers).toHaveLength(1);
    const [provider] = view.providers;
    expect(provider).toMatchObject({
      alias: "cbgw",
      status: "listed",
      harnesses: ["pi"],
    });
    expect(provider?.models.map((m) => m.name).sort()).toEqual([
      "cbgw/deepseek-v4.1-flash",
      "cbgw/zai-org/GLM-5.3",
    ]);
  });

  // TEST_SCENARIO: a refused key, an endpoint that does not list models, and a gateway that is down all leave the provider unavailable with no models, which the picker tells apart from a listing that came back empty-handed.
  it.each([401, 404, 503])(
    "reads unavailable when the listing answers HTTP %i",
    async (status) => {
      const { catalog } = catalogAnswering(() => new Response("", { status }));
      const view = await catalog.read([gateway], harnesses);
      expect(view.providers[0]).toMatchObject({
        status: "unavailable",
        listedAt: null,
        models: [],
      });
    },
  );
});
