import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { templateToView } from "../../modules/connections/domain/connection-template.js";

const SECRET_REF = { storeId: "k8s", path: "test", field: "" };
const mintSecretRef = (purpose: string) => ({
  ...SECRET_REF,
  path: `test/${purpose}`,
});

function findGhe(creds = {}) {
  const t = buildCatalog(creds).find((c) => c.id === "github-enterprise");
  if (!t) throw new Error("github-enterprise template missing");
  if (t.authKind !== "oauth") throw new Error("expected oauth template");
  return t;
}

describe("GitHub Enterprise connection template", () => {
  it("appears in the catalog regardless of operator config", () => {
    expect(findGhe()).toBeDefined();
    expect(findGhe({ githubEnterprise: {} })).toBeDefined();
    expect(
      findGhe({ githubEnterprise: { host: "ghe.example.com" } }),
    ).toBeDefined();
  });

  it("marks host + clientId + clientSecret required when no operator config", () => {
    const view = templateToView(findGhe());
    const byName = new Map(view.inputs.map((i) => [i.name, i] as const));
    expect(byName.get("host")?.state).toBe("required");
    expect(byName.get("clientId")?.state).toBe("required");
    expect(byName.get("clientSecret")?.state).toBe("required");
    expect(byName.get("clientSecret")?.secret).toBe(true);
  });

  it("flips host to overridable when operator presets it; surfaces preset value", () => {
    const view = templateToView(
      findGhe({ githubEnterprise: { host: "ghe.example.com" } }),
    );
    const byName = new Map(view.inputs.map((i) => [i.name, i] as const));
    expect(byName.get("host")?.state).toBe("overridable");
    expect(byName.get("host")?.presetValue).toBe("ghe.example.com");
    expect(byName.get("clientId")?.state).toBe("required");
  });

  it("flips every OAuth input to overridable when fully operator-preset, never echoing the secret", () => {
    const view = templateToView(
      findGhe({
        githubEnterprise: {
          host: "ghe.example.com",
          clientId: "cid",
          clientSecret: "csec",
        },
      }),
    );
    const byName = new Map(view.inputs.map((i) => [i.name, i] as const));
    expect(byName.get("host")?.state).toBe("overridable");
    expect(byName.get("clientId")?.state).toBe("overridable");
    expect(byName.get("clientId")?.presetValue).toBe("cid");
    expect(byName.get("clientSecret")?.state).toBe("overridable");
    // Secret bytes never echoed back.
    expect(byName.get("clientSecret")?.presetValue).toBeUndefined();
    expect(byName.get("clientSecret")?.secret).toBe(true);
  });

  it("surfaces operator-preset appSlug via template extras", () => {
    const t = findGhe({
      githubEnterprise: { host: "ghe.example.com", appSlug: "my-app" },
    });
    expect(t.extras?.appSlug).toBe("my-app");
  });

  it("substitutes {host} in URLs at build time and emits host-dependent contributions", async () => {
    const t = findGhe();
    const built = await buildConnection(
      t,
      {
        templateId: "github-enterprise",
        authKind: "oauth",
        host: "ghe.example.com",
        clientId: "cid",
        clientSecret: "csec",
      },
      mintSecretRef,
      "https://platform.example.com/api/oauth/callback",
      "Platform",
    );

    if (built.auth.kind !== "oauth") throw new Error("expected oauth auth");
    expect(built.auth.authorizationUrl).toBe(
      "https://ghe.example.com/login/oauth/authorize",
    );
    expect(built.auth.tokenUrl).toBe(
      "https://ghe.example.com/login/oauth/access_token",
    );
    expect(built.auth.host).toBe("ghe.example.com");

    // GH_TOKEN sentinel + GH_HOST literal env mappings.
    const envs = built.contributions.filter((c) => c.kind === "env");
    expect(envs).toContainEqual({
      kind: "env",
      name: "GH_TOKEN",
      placeholder: "dummy-placeholder",
    });
    expect(envs).toContainEqual({
      kind: "env",
      name: "GH_HOST",
      placeholder: "ghe.example.com",
    });

    // api.<host> Bearer egress + <host> Basic egress.
    const egress = built.contributions.filter((c) => c.kind === "egress-host");
    expect(egress.some((c) => c.host === "api.ghe.example.com")).toBe(true);
    const basic = egress.find((c) => c.host === "ghe.example.com");
    expect(basic?.injection?.encoding).toBe("basic-x-access-token");
  });

  it("prefers user-supplied host over operator preset", async () => {
    const t = findGhe({
      githubEnterprise: {
        host: "operator.example.com",
        clientId: "cid",
        clientSecret: "csec",
      },
    });
    const built = await buildConnection(
      t,
      {
        templateId: "github-enterprise",
        authKind: "oauth",
        host: "user.example.com",
      },
      mintSecretRef,
      "https://platform.example.com/api/oauth/callback",
      "Platform",
    );
    if (built.auth.kind !== "oauth") throw new Error("expected oauth auth");
    expect(built.auth.host).toBe("user.example.com");
    expect(built.auth.authorizationUrl).toContain("user.example.com");
  });

  it("throws when no host is resolvable", async () => {
    const t = findGhe();
    await expect(
      buildConnection(
        t,
        {
          templateId: "github-enterprise",
          authKind: "oauth",
          clientId: "cid",
          clientSecret: "csec",
        },
        mintSecretRef,
        "https://platform.example.com/api/oauth/callback",
        "Platform",
      ),
    ).rejects.toThrow(
      /github-enterprise: missing host|missing authorizationUrl/,
    );
  });

  it("carries user-supplied appSlug onto the resulting auth", async () => {
    const t = findGhe();
    const built = await buildConnection(
      t,
      {
        templateId: "github-enterprise",
        authKind: "oauth",
        host: "ghe.example.com",
        clientId: "cid",
        clientSecret: "csec",
        appSlug: "user-supplied-app",
      },
      mintSecretRef,
      "https://platform.example.com/api/oauth/callback",
      "Platform",
    );
    if (built.auth.kind !== "oauth") throw new Error("expected oauth auth");
    expect(built.auth.appSlug).toBe("user-supplied-app");
  });
});

describe("github.com appSlug operator surface", () => {
  it("surfaces appSlug via template.extras when operator configures it", async () => {
    const cat = buildCatalog({
      github: {
        clientId: "cid",
        clientSecret: "csec",
        appSlug: "my-github-app",
      },
    });
    const t = cat.find((c) => c.id === "github");
    if (!t || t.authKind !== "oauth")
      throw new Error("github template missing");
    expect(t.extras?.appSlug).toBe("my-github-app");

    const built = await buildConnection(
      t,
      { templateId: "github", authKind: "oauth" },
      mintSecretRef,
      "https://platform.example.com/api/oauth/callback",
      "Platform",
    );
    if (built.auth.kind !== "oauth") throw new Error("expected oauth auth");
    expect(built.auth.appSlug).toBe("my-github-app");
  });
});
