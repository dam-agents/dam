import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { templateToView } from "../../modules/connections/domain/connection-template.js";

const CALLBACK_URL = "https://cb.example/oauth/callback";

describe("github-app template inputs", () => {
  it("plain github-app exposes no host/apiBaseUrl inputs", () => {
    const t = buildCatalog().find((t) => t.id === "github-app")!;
    const view = templateToView(t, CALLBACK_URL);
    expect(view.inputs.map((i) => i.name)).toEqual([
      "appId",
      "installationId",
      "privateKey",
    ]);
  });

  it("github-enterprise-app requires a host and offers an optional apiBaseUrl override", () => {
    const t = buildCatalog().find((t) => t.id === "github-enterprise-app")!;
    const view = templateToView(t, CALLBACK_URL);
    expect(view.inputs.map((i) => i.name)).toEqual([
      "host",
      "apiBaseUrl",
      "appId",
      "installationId",
      "privateKey",
    ]);
    const host = view.inputs.find((i) => i.name === "host")!;
    expect(host.state).toBe("required");
    const apiBaseUrl = view.inputs.find((i) => i.name === "apiBaseUrl")!;
    expect(apiBaseUrl.state).toBe("optional");
  });

  it("github-enterprise-app's host is overridable when operator-preset", () => {
    const t = buildCatalog({
      githubEnterprise: { host: "ghe.acme.com" },
    }).find((t) => t.id === "github-enterprise-app")!;
    const view = templateToView(t, CALLBACK_URL);
    const host = view.inputs.find((i) => i.name === "host")!;
    expect(host.state).toBe("overridable");
    expect(host.presetValue).toBe("ghe.acme.com");
  });
});
