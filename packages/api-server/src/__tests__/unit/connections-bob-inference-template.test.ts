import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import {
  PROVIDER_TEMPLATE_IDS,
  PROVIDERS,
  providerTypeForTemplateId,
  templateIdForProvider,
} from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

const BOB_HOST = "api.us-east.bob.ibm.com";

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function bobInferenceTemplate() {
  const t = buildCatalog().find((t) => t.id === "bob-inference");
  if (!t) throw new Error("bob-inference template missing from catalog");
  return t;
}

async function buildBobInference() {
  return buildConnection(
    bobInferenceTemplate(),
    {
      templateId: "bob-inference",
      name: "bob-inference",
      authKind: "header",
      value: "bob_prod_bob-apikey_secret",
    },
    mintRef,
    "https://cb.example/oauth/callback",
    "Test",
  );
}

function envOf(contributions: Contribution[], name: string) {
  const c = contributions.find((c) => c.kind === "env" && c.name === name);
  if (c?.kind !== "env") throw new Error(`no env contribution ${name}`);
  return c;
}

function injectsOf(contributions: Contribution[]) {
  return contributions.filter(
    (c): c is Extract<Contribution, { kind: "egress-inject" }> =>
      c.kind === "egress-inject",
  );
}

describe("bob-inference connection template", () => {
  it("is a second mode of the existing bob provider, not a provider of its own", () => {
    expect(PROVIDER_TEMPLATE_IDS.has("bob-inference")).toBe(true);
    expect(providerTypeForTemplateId("bob-inference")).toBe("bob");
    expect(PROVIDERS.bob.modes.map((m) => m.templateId)).toEqual([
      "bob",
      "bob-inference",
    ]);
  });

  it("leaves the shell mode as the bob provider's default", () => {
    expect(templateIdForProvider("bob", "bob_prod_bob-apikey_x")).toBe("bob");
  });

  it("points Claude Code at a base URL that composes to Bob's messages route", async () => {
    const built = await buildBobInference();
    const base = envOf(built.contributions, "ANTHROPIC_BASE_URL").placeholder;

    expect(base).toBe(`https://${BOB_HOST}/inference`);
    expect(new URL("/v1/messages", `${base}/`).pathname).not.toContain("v1/v1");
    expect(`${base}/v1/messages`).toBe(
      `https://${BOB_HOST}/inference/v1/messages`,
    );
  });

  it("keeps the real key gateway-side and disables betas Bob would reject", async () => {
    const built = await buildBobInference();
    const token = envOf(built.contributions, "ANTHROPIC_AUTH_TOKEN");

    expect(token.placeholder).not.toContain("bob_prod");
    expect(
      envOf(built.contributions, "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS")
        .placeholder,
    ).toBe("1");
  });

  it("resolves every Claude Code model tier to an alias Bob serves", async () => {
    const built = await buildBobInference();
    const tier = (name: string) =>
      envOf(built.contributions, `ANTHROPIC_DEFAULT_${name}_MODEL`).placeholder;

    expect(tier("FABLE")).toBe("premium");
    expect(tier("OPUS")).toBe("premium");
    expect(tier("SONNET")).toBe("premium");
    expect(tier("HAIKU")).toBe("flash");
  });

  it("never sets the OpenAI vars — Claude Code does not read them", async () => {
    const built = await buildBobInference();
    const names = built.contributions
      .filter(
        (c): c is Extract<Contribution, { kind: "env" }> => c.kind === "env",
      )
      .map((c) => c.name);

    expect(names.filter((n) => n.startsWith("OPENAI_"))).toEqual([]);
  });

  it("injects the Apikey header and its query-param twin, scoped to /inference/*", async () => {
    const injects = injectsOf((await buildBobInference()).contributions);

    expect(injects).toHaveLength(2);
    for (const inject of injects) {
      expect(inject.host).toBe(BOB_HOST);
      expect(inject.pathPattern).toBe("/inference/*");
    }
    expect(injects[0]).toMatchObject({
      headerName: "Authorization",
      valueFormat: "Apikey {value}",
    });
    expect(injects[1]).toMatchObject({
      headerName: "X-Bobshell-Internal",
      queryParamName: "key",
    });
  });

  it("contributes no env name twice, so first-occurrence-wins cannot shadow a value", async () => {
    const names = (await buildBobInference()).contributions
      .filter(
        (c): c is Extract<Contribution, { kind: "env" }> => c.kind === "env",
      )
      .map((c) => c.name);

    expect(names).toHaveLength(new Set(names).size);
  });
});

describe("provider preset catalog parity", () => {
  it("backs every provider preset template id with a catalog entry", () => {
    const ids = new Set(buildCatalog().map((t) => t.id));
    const missing = [...PROVIDER_TEMPLATE_IDS].filter((id) => !ids.has(id));

    expect(missing).toEqual([]);
  });
});
