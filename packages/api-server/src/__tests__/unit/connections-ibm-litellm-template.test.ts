import { readFileSync } from "node:fs";
import { contribution as contributionSchema } from "agent-runtime-api";
import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { connectionSecretAnnotations } from "../../modules/connections/domain/connection-sds.js";

// TEST_OVERVIEW: the IBM LiteLLM connection is what points Bob at the proxy, so it must carry the gateway env Bob reads, the path rewrite that turns Bob's /inference/v1 calls into plain /v1, and a model the proxy serves, since Bob's own default is one the proxy refuses. It must not carry the flag that moves Claude Code's permission classifier off the model call, which Curve Bender still needs.

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

const DISABLE_BETAS = "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS";

describe("ibm-litellm connection template", () => {
  // TEST_SCENARIO: the proxy carries Claude Code's beta header and answers auto mode's permission check on the model call, which the flag would move to a client-side prompt the proxy's Sonnet model refuses — so a safe tool call would be denied.
  it("sends the beta-off flag to Curve Bender only", async () => {
    const ete = await buildIbmLitellm();
    expect(envOf(ete.contributions, DISABLE_BETAS)).toBeUndefined();

    const curveBender = await buildIbmLitellm("curve-bender");
    expect(envOf(curveBender.contributions, DISABLE_BETAS)).toMatchObject({
      placeholder: "1",
    });
  });

  // TEST_SCENARIO: a Connection stores the preset's contributions when it is created, so the Connections made before the preset dropped the flag keep it until the migration takes it out — from those Connections only, and the agents holding one are sent their state again.
  it("takes the flag out of the Connections made before the preset dropped it", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../db/drizzle/0093_drop_litellm_disable_experimental_betas.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const dropped = migration.match(
      /\(item ->> 'name'\) IS DISTINCT FROM '([A-Z0-9_]+)'/,
    )?.[1];
    const templateId = migration.match(/c\.template_id = '([a-z-]+)'/)?.[1];

    expect(dropped).toBe(DISABLE_BETAS);
    expect(templateId).toBe("ibm-litellm");
    expect(
      (await buildIbmLitellm()).contributions.some(
        (c) => c.kind === "env" && c.name === dropped,
      ),
    ).toBe(false);
    expect(migration).toContain("UPDATE runtime_state_outbox");
  });

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

  // TEST_SCENARIO: Curve Bender serves open models only, so Bob — like Codex and Pi — has to start on DeepSeek V4.1 Flash rather than on a Claude model this proxy does not know.
  it("pins Bob to DeepSeek", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");
    expect(envOf(contributions, "BOB_SHELL_MODEL")).toMatchObject({
      placeholder: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    });
  });

  it("reserves Sonnet for the classifier and pins work slots to DeepSeek", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");
    for (const name of [
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]) {
      expect(envOf(contributions, name)).toMatchObject({
        placeholder: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
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

  // TEST_SCENARIO: a stored Connection keeps the preset it was created with, so this backfill rewrites its whole env from the preset as it stands — the preset is that env's only writer — and the list must be the preset's list, name for name, or a preset change leaves stored Connections on the old model and window.
  it("backfills existing connections with the preset's whole env", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../db/drizzle/0103_curve_bender_deepseek_defaults.sql",
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
    const env = contributions.filter((c) => c.kind === "env");
    expect(defaults).toHaveLength(env.length);
    for (const contribution of env)
      expect(defaults).toContainEqual(contribution);
  });

  // TEST_SCENARIO: Pi applies one model config to every model the endpoint lists, so it must be told these are reasoning models with a context no larger than the supported deployment window — otherwise it drops their thinking and compacts too late.
  it("tells Pi the endpoint serves reasoning models with the deployment's 1M context", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");

    expect(envOf(contributions, "OPENAI_PROXY_REASONING")).toMatchObject({
      placeholder: "1",
    });
    expect(envOf(contributions, "OPENAI_PROXY_CONTEXT_WINDOW")).toMatchObject({
      placeholder: "1048576",
    });
  });

  // TEST_SCENARIO: Claude Code reads one window per process and knows nothing about the endpoint's models, so it must be told the deployment's real 1M — a smaller number compacts long sessions far below the ceiling the operator measured.
  it("tells Claude Code the endpoint's 1M context", async () => {
    const { contributions } = await buildIbmLitellm("curve-bender");

    expect(
      envOf(contributions, "CLAUDE_CODE_MAX_CONTEXT_TOKENS"),
    ).toMatchObject({ placeholder: "1048576" });
  });
});
