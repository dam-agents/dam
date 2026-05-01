import { describe, it, expect } from "vitest";

import {
  createOAuthAppRegistry,
  matchesAppConnection,
} from "../../modules/connections/infrastructure/oauth-apps.js";

describe("OAuth app registry — descriptors", () => {
  it("lists GitHub.com, GitHub Enterprise, and Generic as available app types", () => {
    const reg = createOAuthAppRegistry();
    const ids = reg.list().map((d) => d.id);
    expect(ids).toEqual(["github", "github-enterprise", "generic"]);
  });

  it("each descriptor declares its cardinality", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("github")!.cardinality).toBe("single");
    expect(reg.get("github-enterprise")!.cardinality).toBe("single");
    expect(reg.get("generic")!.cardinality).toBe("multiple");
  });

  it("each descriptor surfaces input fields the UI needs to render the connect form", () => {
    const reg = createOAuthAppRegistry();
    const github = reg.get("github")!;
    expect(github.inputs.map((i) => i.name)).toEqual(["clientId", "clientSecret"]);
    expect(github.inputs.find((i) => i.name === "clientSecret")?.secret).toBe(true);

    const ghe = reg.get("github-enterprise")!;
    expect(ghe.inputs.map((i) => i.name)).toEqual(["host", "clientId", "clientSecret"]);
  });

  it("descriptors carry a stable connectionKey separate from the id", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("github")!.connectionKey).toBe("github");
    expect(reg.get("github-enterprise")!.connectionKey).toBe("github-enterprise");
  });

  it("get() returns null for an unknown app id without throwing", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("not-a-real-app")).toBeNull();
  });
});

describe("OAuth app registry — build()", () => {
  it("builds the GitHub.com flow from user-supplied client credentials", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("github", { clientId: "id", clientSecret: "sec" });
    expect(built.provider.authorizationUrl).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://github.com/login/oauth/access_token",
    );
    expect(built.provider.tokenEndpointAcceptJson).toBe(true);
    expect(built.provider.clientId).toBe("id");
    expect(built.provider.clientSecret).toBe("sec");
    expect(built.provider.scopes).toEqual(["repo", "read:user", "user:email"]);
    expect(built.flow).toEqual({
      connectionKey: "github",
      hostPattern: "api.github.com",
      displayName: "GitHub",
      envMappings: [{ envName: "GH_TOKEN", placeholder: "humr:sentinel" }],
    });
    expect(built.connectionDisplayName).toBe("GitHub");
  });

  it("builds GHE URLs from the user-supplied host", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("github-enterprise", {
      host: "ghe.example.com",
      clientId: "id",
      clientSecret: "sec",
    });
    expect(built.provider.authorizationUrl).toBe(
      "https://ghe.example.com/login/oauth/authorize",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://ghe.example.com/login/oauth/access_token",
    );
    expect(built.flow.hostPattern).toBe("ghe.example.com");
    expect(built.flow.connectionKey).toBe("github-enterprise");
    expect(built.flow.envMappings).toEqual([
      { envName: "GH_TOKEN", placeholder: "humr:sentinel" },
      { envName: "GH_HOST", placeholder: "ghe.example.com" },
    ]);
    expect(built.connectionDisplayName).toBe("GitHub Enterprise (ghe.example.com)");
  });

  it("rejects missing client credentials with a Zod error", () => {
    const reg = createOAuthAppRegistry();
    expect(() => reg.build("github", { clientId: "" })).toThrow();
    expect(() => reg.build("github", { clientId: "id" })).toThrow();
  });

  it("rejects an invalid GHE host (scheme included)", () => {
    const reg = createOAuthAppRegistry();
    expect(() =>
      reg.build("github-enterprise", {
        host: "https://ghe.example.com",
        clientId: "id",
        clientSecret: "sec",
      }),
    ).toThrow(/valid DNS hostname/);
  });

  it("builds a Generic flow from user-supplied auth + token URLs", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("generic", {
      displayName: "Linear",
      hostPattern: "api.linear.app",
      authorizationUrl: "https://linear.app/oauth/authorize",
      tokenEndpoint: "https://api.linear.app/oauth/token",
      scopes: "read write",
      clientId: "id",
      clientSecret: "sec",
    });
    expect(built.provider.authorizationUrl).toBe("https://linear.app/oauth/authorize");
    expect(built.provider.tokenEndpoint).toBe("https://api.linear.app/oauth/token");
    expect(built.provider.scopes).toEqual(["read", "write"]);
    expect(built.flow.hostPattern).toBe("api.linear.app");
    expect(built.flow.connectionKey).toMatch(/^generic-[a-f0-9]{16}$/);
    expect(built.flow.displayName).toBe("Linear");
    expect(built.connectionDisplayName).toBe("Linear");
  });

  it("Generic connectionKey is stable across rebuilds for the same host", () => {
    const reg = createOAuthAppRegistry();
    const a = reg.build("generic", {
      displayName: "First",
      hostPattern: "api.example.com",
      authorizationUrl: "https://example.com/oauth/authorize",
      tokenEndpoint: "https://example.com/oauth/token",
      clientId: "id",
      clientSecret: "sec",
    });
    const b = reg.build("generic", {
      displayName: "Second",
      hostPattern: "api.example.com",
      authorizationUrl: "https://example.com/oauth/authorize",
      tokenEndpoint: "https://example.com/oauth/token",
      clientId: "different",
      clientSecret: "different",
    });
    expect(a.flow.connectionKey).toBe(b.flow.connectionKey);
  });

  it("Generic rejects non-https URLs", () => {
    const reg = createOAuthAppRegistry();
    expect(() =>
      reg.build("generic", {
        displayName: "X",
        hostPattern: "api.example.com",
        authorizationUrl: "http://example.com/oauth/authorize",
        tokenEndpoint: "https://example.com/oauth/token",
        clientId: "id",
        clientSecret: "sec",
      }),
    ).toThrow(/https/);
  });

  it("Generic rejects an empty display name", () => {
    const reg = createOAuthAppRegistry();
    expect(() =>
      reg.build("generic", {
        displayName: "",
        hostPattern: "api.example.com",
        authorizationUrl: "https://example.com/oauth/authorize",
        tokenEndpoint: "https://example.com/oauth/token",
        clientId: "id",
        clientSecret: "sec",
      }),
    ).toThrow(/Display name/);
  });
});

describe("OAuth app registry — admin defaults", () => {
  it("prunes inputs covered by GitHub admin defaults from the descriptor", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin-id", clientSecret: "admin-secret" },
    });
    expect(reg.get("github")!.inputs).toEqual([]);
  });

  it("partial defaults prune only the matching field", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin-id" },
    });
    const inputs = reg.get("github")!.inputs.map((i) => i.name);
    expect(inputs).toEqual(["clientSecret"]);
  });

  it("uses GitHub defaults to fill missing fields when build() is called with empty input", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin-id", clientSecret: "admin-secret" },
    });
    const built = reg.build("github", {});
    expect(built.provider.clientId).toBe("admin-id");
    expect(built.provider.clientSecret).toBe("admin-secret");
  });

  it("user-supplied input overrides admin defaults when both are present", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin-id" },
    });
    const built = reg.build("github", {
      clientId: "user-override",
      clientSecret: "user-secret",
    });
    expect(built.provider.clientId).toBe("user-override");
  });

  it("GHE defaults: full config produces an empty form", () => {
    const reg = createOAuthAppRegistry({
      githubEnterprise: {
        host: "ghe.corp.example",
        clientId: "id",
        clientSecret: "sec",
      },
    });
    expect(reg.get("github-enterprise")!.inputs).toEqual([]);
    const built = reg.build("github-enterprise", {});
    expect(built.flow.hostPattern).toBe("ghe.corp.example");
    expect(built.provider.authorizationUrl).toBe(
      "https://ghe.corp.example/login/oauth/authorize",
    );
  });

  it("Generic descriptor is unaffected by GitHub-only defaults", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin", clientSecret: "admin" },
    });
    expect(reg.get("generic")!.inputs.map((i) => i.name)).toEqual([
      "displayName",
      "hostPattern",
      "authorizationUrl",
      "tokenEndpoint",
      "scopes",
      "clientId",
      "clientSecret",
    ]);
  });
});

describe("matchesAppConnection", () => {
  it("single-instance apps match by exact key", () => {
    const reg = createOAuthAppRegistry();
    const github = reg.get("github")!;
    expect(matchesAppConnection(github, "github")).toBe(true);
    expect(matchesAppConnection(github, "github-something")).toBe(false);
    expect(matchesAppConnection(github, "generic-abc")).toBe(false);
  });

  it("multi-instance apps match by prefix", () => {
    const reg = createOAuthAppRegistry();
    const generic = reg.get("generic")!;
    expect(matchesAppConnection(generic, "generic")).toBe(true);
    expect(matchesAppConnection(generic, "generic-abc1234567890def")).toBe(true);
    expect(matchesAppConnection(generic, "github")).toBe(false);
    // No accidental match on "generic-enterprise" if such an app type ever exists.
    expect(matchesAppConnection(generic, "genericstuff")).toBe(false);
  });
});
