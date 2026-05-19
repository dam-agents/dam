import { describe, it, expect } from "vitest";

import {
  callbackUrlForApp,
  createOAuthAppRegistry,
  matchesAppConnection,
} from "../../modules/connections/infrastructure/oauth-apps.js";

describe("OAuth app registry — descriptors", () => {
  it("lists the static apps, Google services, and Generic as available app types", () => {
    const reg = createOAuthAppRegistry();
    const ids = reg.list().map((d) => d.id);
    expect(ids).toEqual([
      "github",
      "github-enterprise",
      "spotify",
      "gmail",
      "google-admin",
      "google-analytics",
      "google-calendar",
      "google-classroom",
      "google-docs",
      "google-drive",
      "google-forms",
      "google-health",
      "google-meet",
      "google-photos",
      "google-search-console",
      "google-sheets",
      "google-slides",
      "google-tasks",
      "youtube",
      "generic",
    ]);
  });

  it("each descriptor declares its cardinality", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("github")!.cardinality).toBe("single");
    expect(reg.get("github-enterprise")!.cardinality).toBe("single");
    expect(reg.get("spotify")!.cardinality).toBe("single");
    expect(reg.get("gmail")!.cardinality).toBe("single");
    expect(reg.get("google-drive")!.cardinality).toBe("single");
    expect(reg.get("generic")!.cardinality).toBe("multiple");
  });

  it("Google service descriptors share the credentialFamily 'google'", () => {
    const reg = createOAuthAppRegistry();
    const googleIds = [
      "gmail",
      "google-admin",
      "google-analytics",
      "google-calendar",
      "google-classroom",
      "google-docs",
      "google-drive",
      "google-forms",
      "google-health",
      "google-meet",
      "google-photos",
      "google-search-console",
      "google-sheets",
      "google-slides",
      "google-tasks",
      "youtube",
    ];
    for (const id of googleIds) {
      expect(reg.get(id)!.credentialFamily).toBe("google");
    }
    expect(reg.get("github")!.credentialFamily).toBeUndefined();
    expect(reg.get("spotify")!.credentialFamily).toBeUndefined();
  });

  it("each descriptor surfaces input fields the UI needs to render the connect form", () => {
    const reg = createOAuthAppRegistry();
    const github = reg.get("github")!;
    expect(github.inputs.map((i) => i.name)).toEqual([
      "clientId",
      "clientSecret",
      "appSlug",
    ]);
    expect(github.inputs.find((i) => i.name === "clientSecret")?.secret).toBe(
      true,
    );
    // appSlug is intrinsically optional (OAuth Apps don't have one) — always
    // visible in the form, not gated behind the override toggle that
    // dynamic family-creds / admin-default coverage uses.
    expect(github.inputs.find((i) => i.name === "appSlug")?.optional).toBe(
      true,
    );
    expect(
      github.inputs.find((i) => i.name === "appSlug")?.overridable,
    ).toBeUndefined();

    const ghe = reg.get("github-enterprise")!;
    expect(ghe.inputs.map((i) => i.name)).toEqual([
      "host",
      "clientId",
      "clientSecret",
      "appSlug",
    ]);
    expect(ghe.inputs.find((i) => i.name === "appSlug")?.optional).toBe(true);
    expect(
      ghe.inputs.find((i) => i.name === "appSlug")?.overridable,
    ).toBeUndefined();
  });

  it("descriptors carry a stable connectionKey separate from the id", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("github")!.connectionKey).toBe("github");
    expect(reg.get("github-enterprise")!.connectionKey).toBe(
      "github-enterprise",
    );
  });

  it("get() returns null for an unknown app id without throwing", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("not-a-real-app")).toBeNull();
  });

  // Issue #219: github's `hosts` covers REST API, `git`, and raw-fetch.
  it("the github descriptor declares three injection hosts with their auth schemes", () => {
    const reg = createOAuthAppRegistry();
    const github = reg.get("github")!;
    expect(github.hosts).toEqual([
      { host: "api.github.com" },
      {
        host: "github.com",
        valueFormat: "Basic {value}",
        encoding: "basic-x-access-token",
      },
      { host: "raw.githubusercontent.com" },
    ]);
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
    // Issue #219: three hosts, three schemes, one OAuth dance.
    expect(built.flow).toEqual({
      connectionKey: "github",
      hosts: [
        { host: "api.github.com" },
        {
          host: "github.com",
          valueFormat: "Basic {value}",
          encoding: "basic-x-access-token",
        },
        { host: "raw.githubusercontent.com" },
      ],
      displayName: "GitHub",
      envMappings: [{ envName: "GH_TOKEN", placeholder: "dummy-placeholder" }],
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
    expect(built.flow.hosts).toEqual([{ host: "ghe.example.com" }]);
    expect(built.flow.connectionKey).toBe("github-enterprise");
    expect(built.flow.envMappings).toEqual([
      { envName: "GH_TOKEN", placeholder: "dummy-placeholder" },
      { envName: "GH_HOST", placeholder: "ghe.example.com" },
    ]);
    expect(built.connectionDisplayName).toBe(
      "GitHub Enterprise (ghe.example.com)",
    );
  });

  it("rejects missing client credentials with a Zod error", () => {
    const reg = createOAuthAppRegistry();
    expect(() => reg.build("github", { clientId: "" })).toThrow();
    expect(() => reg.build("github", { clientId: "id" })).toThrow();
  });

  it("builds a Google service flow with the OIDC baseline + service-specific scopes and offline-access auth params", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("google-drive", {
      clientId: "id",
      clientSecret: "sec",
    });
    expect(built.provider.authorizationUrl).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://oauth2.googleapis.com/token",
    );
    expect(built.provider.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(built.provider.extraAuthParams).toEqual({
      access_type: "offline",
      prompt: "consent",
    });
    expect(built.flow).toEqual({
      connectionKey: "google-drive",
      hosts: [
        { host: "www.googleapis.com", pathPattern: "/drive/*" },
        { host: "www.googleapis.com", pathPattern: "/upload/drive/*" },
      ],
      displayName: "Google Drive",
    });
    expect(built.connectionDisplayName).toBe("Google Drive");
  });

  it("Google Health uses the health.googleapis.com host and health-specific scopes", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("google-health", {
      clientId: "id",
      clientSecret: "sec",
    });
    expect(built.flow.hosts.map((h) => h.host)).toEqual([
      "health.googleapis.com",
    ]);
    expect(built.provider.scopes).toContain(
      "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    );
    expect(built.provider.scopes).toContain(
      "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    );
  });

  it("builds the Spotify flow with default scopes and no env-var injection", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("spotify", { clientId: "id", clientSecret: "sec" });
    expect(built.provider.authorizationUrl).toBe(
      "https://accounts.spotify.com/authorize",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://accounts.spotify.com/api/token",
    );
    expect(built.provider.tokenEndpointAcceptJson).toBe(true);
    expect(built.provider.scopes).toContain("user-read-private");
    expect(built.provider.scopes).toContain("user-modify-playback-state");
    expect(built.flow).toEqual({
      connectionKey: "spotify",
      hosts: [{ host: "api.spotify.com" }],
      displayName: "Spotify",
    });
    expect(built.flow.envMappings).toBeUndefined();
    expect(built.connectionDisplayName).toBe("Spotify");
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
    expect(built.provider.authorizationUrl).toBe(
      "https://linear.app/oauth/authorize",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://api.linear.app/oauth/token",
    );
    expect(built.provider.scopes).toEqual(["read", "write"]);
    expect(built.flow.hosts).toEqual([{ host: "api.linear.app" }]);
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
  it("marks inputs covered by GitHub admin defaults as overridable and flags the descriptor", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin-id", clientSecret: "admin-secret" },
    });
    const github = reg.get("github")!;
    // All required fields are admin-defaulted, so the form has nothing to ask
    // for on the happy path — but the inputs are still surfaced so the UI
    // can offer an override toggle ("use a different app").
    expect(github.defaultsApplied).toBe(true);
    // Required = !overridable && !optional (appSlug is optional so it
    // never appears in the required set regardless of admin coverage).
    expect(
      github.inputs
        .filter((i) => !i.overridable && !i.optional)
        .map((i) => i.name),
    ).toEqual([]);
    expect(github.inputs.map((i) => i.name)).toEqual([
      "clientId",
      "clientSecret",
      "appSlug",
    ]);
  });

  it("partial defaults make only the matching field overridable", () => {
    const reg = createOAuthAppRegistry({
      github: { clientId: "admin-id" },
    });
    const github = reg.get("github")!;
    // Required (non-overridable, non-optional) inputs remain — the form
    // still asks the user for clientSecret. The descriptor is *not* flagged
    // as defaultsApplied because the form still requires user input.
    expect(github.defaultsApplied).toBeUndefined();
    expect(
      github.inputs
        .filter((i) => !i.overridable && !i.optional)
        .map((i) => i.name),
    ).toEqual(["clientSecret"]);
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

  it("admin-default appSlug surfaces on the descriptor and threads through the built flow", () => {
    const reg = createOAuthAppRegistry({
      github: {
        clientId: "admin-id",
        clientSecret: "admin-secret",
        appSlug: "platform-app",
      },
    });
    expect(reg.get("github")!.appSlug).toBe("platform-app");
    expect(reg.get("github")!.defaultsApplied).toBe(true);
    const built = reg.build("github", {});
    expect(built.flow.appSlug).toBe("platform-app");
  });

  it("user-supplied appSlug overrides admin default when both are present", () => {
    const reg = createOAuthAppRegistry({
      github: {
        clientId: "admin-id",
        clientSecret: "admin-secret",
        appSlug: "default-app",
      },
    });
    const built = reg.build("github", { appSlug: "user-app" });
    expect(built.flow.appSlug).toBe("user-app");
  });

  it("rejects appSlugs that violate GitHub's slug rules", () => {
    const reg = createOAuthAppRegistry();
    const baseInput = { clientId: "id", clientSecret: "sec" };
    // Whitespace / uppercase — should never have been accepted.
    expect(() =>
      reg.build("github", { ...baseInput, appSlug: "Has Spaces" }),
    ).toThrow(/App slug/);
    expect(() =>
      reg.build("github", { ...baseInput, appSlug: "MyApp" }),
    ).toThrow(/App slug/);
    // GitHub disallows leading, trailing, and consecutive hyphens — mirror that.
    expect(() =>
      reg.build("github", { ...baseInput, appSlug: "-leading" }),
    ).toThrow(/App slug/);
    expect(() =>
      reg.build("github", { ...baseInput, appSlug: "trailing-" }),
    ).toThrow(/App slug/);
    expect(() =>
      reg.build("github", { ...baseInput, appSlug: "double--hyphen" }),
    ).toThrow(/App slug/);
    // 1–39 chars: 40 chars is one over the limit.
    expect(() =>
      reg.build("github", { ...baseInput, appSlug: "a".repeat(40) }),
    ).toThrow(/App slug/);
  });

  it("accepts well-formed GitHub App slugs", () => {
    const reg = createOAuthAppRegistry();
    const baseInput = { clientId: "id", clientSecret: "sec" };
    for (const slug of [
      "a",
      "dependabot",
      "github-actions",
      "my-app-1",
      "a".repeat(39),
    ]) {
      const built = reg.build("github", { ...baseInput, appSlug: slug });
      expect(built.flow.appSlug).toBe(slug);
    }
  });

  it("treats an empty-string appSlug input as 'not set' (no flow.appSlug)", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("github", {
      clientId: "id",
      clientSecret: "sec",
      appSlug: "",
    });
    expect(built.flow.appSlug).toBeUndefined();
  });

  it("GHE defaults: full config flags defaultsApplied and surfaces all inputs as overridable", () => {
    const reg = createOAuthAppRegistry({
      githubEnterprise: {
        host: "ghe.corp.example",
        clientId: "id",
        clientSecret: "sec",
      },
    });
    const ghe = reg.get("github-enterprise")!;
    expect(ghe.defaultsApplied).toBe(true);
    expect(
      ghe.inputs
        .filter((i) => !i.overridable && !i.optional)
        .map((i) => i.name),
    ).toEqual([]);
    const built = reg.build("github-enterprise", {});
    expect(built.flow.hosts).toEqual([{ host: "ghe.corp.example" }]);
    expect(built.provider.authorizationUrl).toBe(
      "https://ghe.corp.example/login/oauth/authorize",
    );
  });

  it("GHE admin-default appSlug threads through to the flow", () => {
    const reg = createOAuthAppRegistry({
      githubEnterprise: {
        host: "ghe.corp.example",
        clientId: "id",
        clientSecret: "sec",
        appSlug: "ghe-platform-app",
      },
    });
    expect(reg.get("github-enterprise")!.appSlug).toBe("ghe-platform-app");
    const built = reg.build("github-enterprise", {});
    expect(built.flow.appSlug).toBe("ghe-platform-app");
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
    expect(reg.get("generic")!.defaultsApplied).toBeUndefined();
  });
});

describe("callbackUrlForApp", () => {
  it("returns the standard callback URL for descriptors without a quirk", () => {
    const reg = createOAuthAppRegistry();
    const github = reg.get("github")!;
    expect(callbackUrlForApp(github, "http://localhost:4444")).toBe(
      "http://localhost:4444/api/oauth/callback",
    );
    expect(callbackUrlForApp(github, "https://app.example.com")).toBe(
      "https://app.example.com/api/oauth/callback",
    );
  });

  it("rewrites localhost → 127.0.0.1 for Spotify on a local-dev base URL", () => {
    const reg = createOAuthAppRegistry();
    const spotify = reg.get("spotify")!;
    expect(callbackUrlForApp(spotify, "http://localhost:4444")).toBe(
      "http://127.0.0.1:4444/api/oauth/callback",
    );
  });

  it("leaves Spotify's callback URL alone when the base URL host is not localhost", () => {
    const reg = createOAuthAppRegistry();
    const spotify = reg.get("spotify")!;
    expect(callbackUrlForApp(spotify, "https://app.example.com")).toBe(
      "https://app.example.com/api/oauth/callback",
    );
  });

  it("does not rewrite hosts that merely start with `localhost`", () => {
    const reg = createOAuthAppRegistry();
    const spotify = reg.get("spotify")!;
    expect(
      callbackUrlForApp(spotify, "http://localhost.example.com:4444"),
    ).toBe("http://localhost.example.com:4444/api/oauth/callback");
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
    expect(matchesAppConnection(generic, "generic-abc1234567890def")).toBe(
      true,
    );
    expect(matchesAppConnection(generic, "github")).toBe(false);
    // No accidental match on "generic-enterprise" if such an app type ever exists.
    expect(matchesAppConnection(generic, "genericstuff")).toBe(false);
  });
});
