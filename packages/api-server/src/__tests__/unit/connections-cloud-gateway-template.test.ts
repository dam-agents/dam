import { describe, expect, it } from "vitest";
import {
  CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
  listingForTemplate,
  parseCloudGatewayEndpoint,
  type Contribution,
  type SecretRef,
} from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

/**
 * TEST_OVERVIEW: CurveBender through the IBM Cloud Gateway is connected with
 * the user's gateway key and their project endpoint. Only an HTTPS endpoint
 * of one region under rhai.ibm.com with a project's inference path is
 * accepted, because that endpoint decides where the credential gateway
 * injects the key. The Connection sends the key on that host and path alone,
 * hands the agent an inert placeholder and the endpoint, and lists its models
 * from the project's own OpenAI model list.
 */

const ENDPOINT = "https://us-east.rhai.ibm.com/v1/projects/p-1234/inference";

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

async function buildGateway(endpoint: string | undefined) {
  const template = buildCatalog().find(
    (t) => t.id === CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
  );
  if (!template) throw new Error("gateway template missing from catalog");
  return buildConnection(
    template,
    {
      templateId: CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
      name: "gateway",
      authKind: "header",
      value: "gateway-key",
      ...(endpoint === undefined ? {} : { configInputs: { endpoint } }),
    },
    mintRef,
    "https://platform.example/oauth/callback",
    "Platform",
  );
}

const egressOf = (contributions: Contribution[]) =>
  contributions.filter(
    (c) =>
      c.kind === "egress-allow" ||
      c.kind === "egress-inject" ||
      c.kind === "egress-sign",
  );

const envOf = (contributions: Contribution[]) =>
  Object.fromEntries(
    contributions.flatMap((c) =>
      c.kind === "env" ? [[c.name, c.placeholder]] : [],
    ),
  );

describe("IBM Cloud Gateway endpoint", () => {
  // TEST_SCENARIO: the gateway serves several regions, so any one DNS label before rhai.ibm.com is a region, and a trailing slash a user pastes is dropped.
  it.each([
    ENDPOINT,
    "https://eu-de.rhai.ibm.com/v1/projects/p-1234/inference",
    "https://jp-tok.rhai.ibm.com/v1/projects/0b6e6c1e-4b8f-4a6e-9a3c-7d2f9b1a5e00/inference",
    `${ENDPOINT}/`,
  ])("accepts %s", (endpoint) => {
    expect(parseCloudGatewayEndpoint(endpoint)).toMatchObject({
      url: endpoint.replace(/\/$/, ""),
      path: expect.stringMatching(/^\/v1\/projects\/[^/]+\/inference$/),
    });
  });

  // TEST_SCENARIO: anything that would send the key elsewhere is refused: plain HTTP, another domain or a look-alike, a nested subdomain, a port, credentials in the URL, and a path that is not exactly a project's inference path.
  it.each([
    "http://us-east.rhai.ibm.com/v1/projects/p-1234/inference",
    "https://us-east.rhai.ibm.com.evil.example/v1/projects/p-1234/inference",
    "https://rhai.ibm.com/v1/projects/p-1234/inference",
    "https://a.b.rhai.ibm.com/v1/projects/p-1234/inference",
    "https://us-east.rhai.ibm.com:8443/v1/projects/p-1234/inference",
    "https://user@us-east.rhai.ibm.com/v1/projects/p-1234/inference",
    "https://us-east.rhai.ibm.com/v1/projects/p-1234",
    "https://us-east.rhai.ibm.com/v1/projects/p-1234/inference/chat",
    "https://us-east.rhai.ibm.com/v1/projects/../inference",
    "https://us-east.rhai.ibm.com/v1/projects/p%2F1/inference",
    "https://us-east.rhai.ibm.com/v1/projects/p-1234/inference?x=1",
    "https://litellm.cb.ete.res.ibm.com/v1",
    "",
  ])("refuses %s", (endpoint) => {
    expect(parseCloudGatewayEndpoint(endpoint)).toBeNull();
  });

  // TEST_SCENARIO: a pasted value is untrusted, so a long run of slashes that does not end the value is refused in linear time, not after a quadratic trim.
  it("refuses a long run of slashes quickly", () => {
    const endpoint = `${ENDPOINT}${"/".repeat(20_000)}x`;
    const started = performance.now();

    expect(parseCloudGatewayEndpoint(endpoint)).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("IBM Cloud Gateway connection template", () => {
  // TEST_SCENARIO: the key is injected as a bearer token on the region's host and only under the project's inference path, which is where the router's chat calls and the model listing go; no other host is allowed.
  it("injects the key on the project's path of the region's host", async () => {
    const { contributions, auth } = await buildGateway(ENDPOINT);
    expect(egressOf(contributions)).toEqual([
      {
        kind: "egress-inject",
        host: "us-east.rhai.ibm.com",
        pathPattern: "/v1/projects/p-1234/inference/*",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ]);
    expect(auth).toMatchObject({
      kind: "header",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
  });

  // TEST_SCENARIO: the agent's env layer carries the endpoint and an inert placeholder, never the key, so the Model Router and the listing reach the gateway with the placeholder the credential gateway replaces.
  it("hands the agent the endpoint and a placeholder", async () => {
    const { contributions, secrets } = await buildGateway(`${ENDPOINT}/`);
    expect(envOf(contributions)).toEqual({
      OPENAI_API_KEY: "dummy-placeholder",
      OPENAI_BASE_URL: ENDPOINT,
    });
    expect(JSON.stringify(contributions)).not.toContain("gateway-key");
    expect([...secrets.values()][0]).toMatchObject({ value: "gateway-key" });
  });

  // TEST_SCENARIO: a Connection without an endpoint, or with one outside the gateway, is refused before anything is stored.
  it.each([
    [undefined, /Project endpoint: required/],
    ["https://api.openai.com/v1", /not an IBM Cloud Gateway project endpoint/],
    [
      "http://us-east.rhai.ibm.com/v1/projects/p-1234/inference",
      /not an IBM Cloud Gateway project endpoint/,
    ],
  ])("refuses the endpoint %s", async (endpoint, message) => {
    await expect(buildGateway(endpoint)).rejects.toThrow(message);
  });

  // TEST_SCENARIO: the project's OpenAI model list sits right under the endpoint, which already carries its API version, and is read with the key as a bearer token.
  it("lists models from the endpoint's own model list", () => {
    expect(
      listingForTemplate(CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID)?.spec,
    ).toEqual({
      urlEnv: ["OPENAI_BASE_URL"],
      tokenEnv: ["OPENAI_API_KEY"],
      credentialHeader: "authorization",
      path: "/models",
      shape: "openai-models",
    });
  });
});
