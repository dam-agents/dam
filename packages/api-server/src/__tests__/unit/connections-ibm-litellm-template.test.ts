import { readFileSync } from "node:fs";
import { contribution as contributionSchema } from "agent-runtime-api";
import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { connectionSecretAnnotations } from "../../modules/connections/domain/connection-sds.js";

// TEST_OVERVIEW: the IBM LiteLLM connection is what points Bob at the proxy, so it must carry the gateway env Bob reads, the path rewrite that turns Bob's /inference/v1 calls into plain /v1, and a model the proxy serves, since Bob's own default is one the proxy refuses.

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

  // TEST_SCENARIO: Bob's built-in default is a tier alias only its own gateway serves, and the proxy answers a model it does not list with 403 — so the connection pins a Claude model the proxy serves, which the agent's Config panel can still override.
  it("pins Bob to a Claude model the proxy serves", async () => {
    const { contributions } = await buildIbmLitellm();
    expect(envOf(contributions, "BOB_SHELL_MODEL")).toMatchObject({
      placeholder: "aws/claude-sonnet-4-6",
    });
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

  // TEST_SCENARIO: Curve Bender serves open models only, so Bob — like Codex and Pi — has to start on GLM rather than on a Claude model this proxy does not know.
  it("pins Bob to GLM", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");
    expect(envOf(contributions, "BOB_SHELL_MODEL")).toMatchObject({
      placeholder: "rits/zai-org/glm-5-3",
    });
  });

  it("reserves Sonnet for the classifier and pins work slots to GLM", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");
    for (const name of [
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]) {
      expect(envOf(contributions, name)).toMatchObject({
        placeholder: "rits/zai-org/glm-5-3",
      });
    }
    expect(
      envOf(contributions, "ANTHROPIC_DEFAULT_SONNET_MODEL"),
    ).toMatchObject({
      placeholder: "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4",
    });
    expect(envOf(contributions, "CLAUDE_CODE_AUTO_MODE_SERVER")).toMatchObject({
      placeholder: "0",
    });
    expect(envOf(contributions, "ENABLE_TOOL_SEARCH")).toMatchObject({
      placeholder: "false",
    });
    const ete = await buildIbmLitellm();
    expect(
      envOf(ete.contributions, "ANTHROPIC_DEFAULT_SONNET_MODEL"),
    ).toBeUndefined();
    expect(
      envOf(ete.contributions, "CLAUDE_CODE_AUTO_MODE_SERVER"),
    ).toBeUndefined();
  });

  it("backfills existing connections with the same defaults as new ones", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../db/drizzle/0063_curve_bender_classifier_defaults.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const defaults = contributionSchema
      .array()
      .parse(
        JSON.parse(
          migration.match(/SELECT '(\[[\s\S]*?\])'::jsonb/)?.[1] ?? "null",
        ),
      );
    const { contributions } = await buildIbmLitellm("curve-bender");
    expect(defaults).toHaveLength(10);
    for (const contribution of defaults)
      expect(contributions).toContainEqual(contribution);
  });

  // TEST_SCENARIO: Pi applies one model config to every model the endpoint lists, so it must be told these are reasoning models with a context no larger than the supported deployment window — otherwise it drops their thinking and compacts too late.
  it("tells Pi the endpoint serves reasoning models with a 256k context", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");

    expect(envOf(contributions, "OPENAI_PROXY_REASONING")).toMatchObject({
      placeholder: "1",
    });
    expect(envOf(contributions, "OPENAI_PROXY_CONTEXT_WINDOW")).toMatchObject({
      placeholder: "256000",
    });
  });

  // TEST_SCENARIO: Claude Code knows nothing about the endpoint's models and assumes a window for them, so it must be told the real one — otherwise it compacts too late and the endpoint refuses the request.
  it("tells Claude Code the endpoint's 256k context", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");

    expect(
      envOf(contributions, "CLAUDE_CODE_MAX_CONTEXT_TOKENS"),
    ).toMatchObject({ placeholder: "256000" });
  });
});
