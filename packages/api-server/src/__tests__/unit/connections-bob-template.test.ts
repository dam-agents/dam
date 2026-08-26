import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { PROVIDER_TEMPLATE_IDS } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

const BOB_HOST = "api.us-east.bob.ibm.com";

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function bobTemplate() {
  const t = buildCatalog().find((t) => t.id === "bob");
  if (!t) throw new Error("bob template missing from catalog");
  return t;
}

async function buildBob(configInputs?: Record<string, string>) {
  return buildConnection(
    bobTemplate(),
    {
      templateId: "bob",
      name: "bob",
      authKind: "header",
      value: "bob_prod_bob-apikey_secret",
      ...(configInputs ? { configInputs } : {}),
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

function envNames(contributions: Contribution[]) {
  return contributions
    .filter(
      (c): c is Extract<Contribution, { kind: "env" }> => c.kind === "env",
    )
    .map((c) => c.name);
}

function injectsOf(contributions: Contribution[]) {
  return contributions.filter(
    (c): c is Extract<Contribution, { kind: "egress-inject" }> =>
      c.kind === "egress-inject",
  );
}

describe("bob connection template serves shell and inference from one key", () => {
  it("stays a single template — inference is not a separate one", () => {
    expect(PROVIDER_TEMPLATE_IDS.has("bob")).toBe(true);
    expect(PROVIDER_TEMPLATE_IDS.has("bob-inference")).toBe(false);
    expect(buildCatalog().filter((t) => t.id.startsWith("bob"))).toHaveLength(
      1,
    );
  });

  it("contributes the shell credential and the Claude Code wiring together", async () => {
    const names = envNames((await buildBob()).contributions);

    expect(names).toContain("BOBSHELL_API_KEY");
    expect(names).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(names).toContain("ANTHROPIC_BASE_URL");
  });

  it("points Claude Code at a base URL that composes to Bob's messages route", async () => {
    const built = await buildBob();
    const base = envOf(built.contributions, "ANTHROPIC_BASE_URL").placeholder;

    expect(base).toBe(`https://${BOB_HOST}/inference`);
    expect(`${base}/v1/messages`).toBe(
      `https://${BOB_HOST}/inference/v1/messages`,
    );
    expect(base).not.toMatch(/\/v1$/);
  });

  it("keeps the real key gateway-side and disables betas Bob would reject", async () => {
    const built = await buildBob();

    for (const name of ["BOBSHELL_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
      expect(envOf(built.contributions, name).placeholder).not.toContain(
        "bob_prod",
      );
    }
    expect(
      envOf(built.contributions, "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS")
        .placeholder,
    ).toBe("1");
  });

  it("resolves every Claude Code model tier to an alias Bob serves", async () => {
    const built = await buildBob();
    const tier = (name: string) =>
      envOf(built.contributions, `ANTHROPIC_DEFAULT_${name}_MODEL`).placeholder;

    expect(tier("FABLE")).toBe("premium");
    expect(tier("OPUS")).toBe("premium");
    expect(tier("SONNET")).toBe("premium");
    expect(tier("HAIKU")).toBe("flash");
  });

  it("never sets the OpenAI vars — Claude Code does not read them", async () => {
    const names = envNames((await buildBob()).contributions);

    expect(names.filter((n) => n.startsWith("OPENAI_"))).toEqual([]);
  });

  it("adds no injection beyond the two Bob already had", async () => {
    const injects = injectsOf((await buildBob()).contributions);

    expect(injects).toHaveLength(2);
    expect(injects[0]).toMatchObject({
      host: BOB_HOST,
      headerName: "Authorization",
      valueFormat: "Apikey {value}",
    });
    expect(injects[1]).toMatchObject({
      host: BOB_HOST,
      headerName: "X-Bobshell-Internal",
      queryParamName: "key",
    });
  });

  it("keeps the shell pins working alongside the inference wiring", async () => {
    const built = await buildBob({ model: "premium-shell", teamId: "t-1" });

    expect(envOf(built.contributions, "BOB_SHELL_MODEL").placeholder).toBe(
      "premium-shell",
    );
    expect(envOf(built.contributions, "BOB_TEAM_ID").placeholder).toBe("t-1");
    expect(envOf(built.contributions, "ANTHROPIC_BASE_URL").placeholder).toBe(
      `https://${BOB_HOST}/inference`,
    );
  });

  it("contributes no env name twice, so first-occurrence-wins cannot shadow a value", async () => {
    const names = envNames(
      (await buildBob({ model: "premium-shell" })).contributions,
    );

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
