import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { connectionSecretAnnotations } from "../../modules/connections/domain/connection-sds.js";

// TEST_OVERVIEW: the IBM LiteLLM connection is what points Bob at the proxy.
// It must carry the gateway env Bob reads, a model the proxy actually serves,
// and the path rewrite that turns Bob's /inference/v1 calls into plain /v1.

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

async function buildIbmLitellm(configInputs?: Record<string, string>) {
  const template = buildCatalog().find((t) => t.id === "ibm-litellm");
  if (!template) throw new Error("ibm-litellm template missing from catalog");
  return buildConnection(
    template,
    {
      templateId: "ibm-litellm",
      name: "litellm",
      authKind: "header",
      value: "sk-real-token",
      ...(configInputs ? { configInputs } : {}),
    },
    mintRef,
    "https://cb.example/oauth/callback",
    "Platform",
  );
}

function envOf(contributions: Contribution[], name: string) {
  return contributions.find((c) => c.kind === "env" && c.name === name);
}

describe("ibm-litellm connection template", () => {
  // TEST_SCENARIO: an agent granted this connection runs Bob against the proxy,
  // so the gateway URL, a placeholder key and a proxy-served model must all ride
  // along — Bob's own default model name does not exist on the proxy.
  it("contributes the Bob gateway env with a proxy-served model", async () => {
    const { contributions } = await buildIbmLitellm();

    expect(envOf(contributions, "BOB_GATEWAY_URL")).toMatchObject({
      placeholder: "https://ete-litellm.ai-models.vpc.res.ibm.com",
    });
    expect(envOf(contributions, "BOBSHELL_API_KEY")).toBeDefined();
    expect(envOf(contributions, "BOB_SHELL_MODEL")).toMatchObject({
      placeholder: "aws/claude-opus-4-8",
    });
  });

  // TEST_SCENARIO: the model is a config input, so a user who wants another
  // model on the same proxy overrides the default instead of editing code.
  it("lets the connection override the default Bob model", async () => {
    const { contributions } = await buildIbmLitellm({
      bobModel: "aws/claude-sonnet-4-6",
    });

    expect(envOf(contributions, "BOB_SHELL_MODEL")).toMatchObject({
      placeholder: "aws/claude-sonnet-4-6",
    });
  });

  // TEST_SCENARIO: the rewrite reaches Envoy only through the Secret
  // annotation, which is the contract the controller reads.
  it("publishes the inference prefix rewrite on the Secret annotation", async () => {
    const { contributions } = await buildIbmLitellm();
    const annotations = connectionSecretAnnotations(contributions);

    expect(
      JSON.parse(annotations["agent-platform.ai/injection-hosts"]),
    ).toContainEqual(
      expect.objectContaining({
        host: "ete-litellm.ai-models.vpc.res.ibm.com",
        pathRewrites: [{ prefix: "/inference/v1/", replacement: "/v1/" }],
      }),
    );
  });
});
