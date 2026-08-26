import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { PROVIDER_TEMPLATE_IDS } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { buildConnectionSdsFields } from "../../modules/connections/domain/connection-sds.js";

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

  it("contributes the shell credential and the inference wiring together", async () => {
    const names = envNames((await buildBob()).contributions);

    expect(names).toContain("BOBSHELL_API_KEY");
    expect(names).toContain("OPENAI_API_KEY");
    expect(names).toContain("OPENAI_BASE_URL");
    expect(names).toContain("OPENAI_PROXY_URL");
  });

  it("points OpenAI clients at a base URL that composes to Bob's verified route", async () => {
    const built = await buildBob();
    const base = envOf(built.contributions, "OPENAI_BASE_URL").placeholder;

    expect(base).toBe(`https://${BOB_HOST}/inference/v1`);
    expect(`${base}/chat/completions`).toBe(
      `https://${BOB_HOST}/inference/v1/chat/completions`,
    );
    expect(envOf(built.contributions, "OPENAI_PROXY_URL").placeholder).toBe(
      base,
    );
  });

  it("keeps the real key gateway-side", async () => {
    const built = await buildBob();

    for (const name of ["BOBSHELL_API_KEY", "OPENAI_API_KEY"]) {
      expect(envOf(built.contributions, name).placeholder).not.toContain(
        "bob_prod",
      );
    }
  });

  it("pins Codex to the wire API and limits Bob actually serves", async () => {
    const built = await buildBob();
    const env = (name: string) => envOf(built.contributions, name).placeholder;

    expect(env("OPENAI_MODEL")).toBe("premium");
    expect(env("OPENAI_PROXY_MODEL")).toBe("premium");
    expect(env("CODEX_WIRE_API")).toBe("chat");
    expect(env("CODEX_CONTEXT_WINDOW")).toBe("200000");
    expect(env("CODEX_MAX_OUTPUT_TOKENS")).toBe("8192");
  });

  it("never sets the Anthropic vars — Bob serves no Anthropic route to API keys", async () => {
    const names = envNames((await buildBob()).contributions);

    expect(names.filter((n) => n.startsWith("ANTHROPIC_"))).toEqual([]);
    expect(names.filter((n) => n.startsWith("CLAUDE_"))).toEqual([]);
  });

  it("injects the two credentials plus a constant user agent Bob's edge accepts", async () => {
    const injects = injectsOf((await buildBob()).contributions);

    expect(injects).toHaveLength(3);
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
    expect(injects[2]).toMatchObject({
      host: BOB_HOST,
      headerName: "User-Agent",
    });
    expect(injects[2]!.valueFormat).not.toContain("{value}");
    expect(injects[2]!.valueFormat).toMatch(/bob/);
  });

  it("bakes every injection into its own SDS file — none may shadow another", async () => {
    const built = await buildBob();
    const sdsKeys = Object.keys(
      buildConnectionSdsFields(built.contributions, "tok"),
    );

    expect(sdsKeys).toHaveLength(injectsOf(built.contributions).length);
  });

  it("keeps the shell pins working alongside the inference wiring", async () => {
    const built = await buildBob({ model: "premium-shell", teamId: "t-1" });

    expect(envOf(built.contributions, "BOB_SHELL_MODEL").placeholder).toBe(
      "premium-shell",
    );
    expect(envOf(built.contributions, "BOB_TEAM_ID").placeholder).toBe("t-1");
    expect(envOf(built.contributions, "OPENAI_BASE_URL").placeholder).toBe(
      `https://${BOB_HOST}/inference/v1`,
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
