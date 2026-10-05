import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { connectionSecretAnnotations } from "../../modules/connections/domain/connection-sds.js";

// TEST_OVERVIEW: the IBM LiteLLM connection is what points Bob at the proxy, so it must carry the gateway env Bob reads and the path rewrite that turns Bob's /inference/v1 calls into plain /v1, while leaving the model to the agent's Config panel.

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

async function buildIbmLitellm(templateId = "ibm-litellm") {
  const template = buildCatalog().find((t) => t.id === templateId);
  if (!template) throw new Error(`${templateId} template missing from catalog`);
  return buildConnection(
    template,
    {
      templateId,
      name: "litellm",
      authKind: "header",
      value: "sk-real-token",
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
  // TEST_SCENARIO: an agent granted this connection runs Bob against the proxy, so the gateway URL and a key placeholder must ride along — and the placeholder stays inert, since a key-shaped one has meant a different backend to some Bob versions.
  it("contributes the Bob gateway env with an inert key placeholder", async () => {
    const { contributions } = await buildIbmLitellm();

    expect(envOf(contributions, "BOB_GATEWAY_URL")).toMatchObject({
      placeholder: "https://ete-litellm.ai-models.vpc.res.ibm.com",
    });
    expect(envOf(contributions, "BOBSHELL_API_KEY")).toMatchObject({
      placeholder: "dummy-placeholder",
    });
  });

  // TEST_SCENARIO: the Bob connection pins the same env name, and an agent can hold both, so this one must never claim it — the model belongs to the agent's Config panel, which reads the list from this very proxy.
  it("never contributes a Bob model", async () => {
    const { contributions } = await buildIbmLitellm();
    expect(envOf(contributions, "BOB_SHELL_MODEL")).toBeUndefined();
  });

  // TEST_SCENARIO: the rewrite reaches Envoy only through the Secret annotation, which is the contract the controller reads.
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

describe("curve-bender connection template", () => {
  // TEST_SCENARIO: Curve Bender is an alternative LiteLLM proxy, so every harness base URL and the credential injection must point at its host, never at the ETE proxy it stands in for.
  it("points every harness and the injection at the Curve Bender host", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");
    const host = "litellm.cb.ete.res.ibm.com";

    for (const name of [
      "ANTHROPIC_BASE_URL",
      "OPENAI_BASE_URL",
      "OPENAI_PROXY_URL",
      "BOB_GATEWAY_URL",
    ]) {
      expect(envOf(contributions, name)).toMatchObject({
        placeholder: `https://${host}`,
      });
    }
    expect(
      JSON.parse(
        connectionSecretAnnotations(contributions)[
          "agent-platform.ai/injection-hosts"
        ],
      ),
    ).toEqual([expect.objectContaining({ host })]);
  });
});
