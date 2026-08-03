import type { ConnectionTemplateView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  buildCreatePayload,
  type CreateFormValues,
} from "../../modules/connections/lib/build-create-payload.js";

const GITHUB_APP_TEMPLATE: ConnectionTemplateView = {
  id: "github-app",
  name: "GitHub App (installation)",
  category: "app",
  isCustom: false,
  authKind: "github-app",
  inputs: [
    { name: "appId", state: "required" },
    { name: "installationId", state: "required" },
    { name: "privateKey", state: "required", secret: true },
  ],
};

const GITHUB_ENTERPRISE_APP_TEMPLATE: ConnectionTemplateView = {
  id: "github-enterprise-app",
  name: "GitHub Enterprise (App installation)",
  category: "app",
  isCustom: false,
  authKind: "github-app",
  inputs: [
    { name: "host", state: "required" },
    { name: "appId", state: "required" },
    { name: "installationId", state: "required" },
    { name: "privateKey", state: "required", secret: true },
  ],
};

const GITHUB_ENTERPRISE_APP_PRESET_TEMPLATE: ConnectionTemplateView = {
  ...GITHUB_ENTERPRISE_APP_TEMPLATE,
  inputs: [
    { name: "host", state: "overridable", presetValue: "ghe.operator.example" },
    ...GITHUB_ENTERPRISE_APP_TEMPLATE.inputs.slice(1),
  ],
};

function values(fields: Record<string, string>): CreateFormValues {
  return { name: "my-connection", fields, overrideDefaults: false };
}

describe("buildCreatePayload (github-app)", () => {
  it("builds without a host field when the template has none", () => {
    const payload = buildCreatePayload(
      GITHUB_APP_TEMPLATE,
      values({ appId: "1", installationId: "2", privateKey: "pem" }),
    );
    expect(payload).toEqual({
      templateId: "github-app",
      name: "my-connection",
      authKind: "github-app",
      appId: "1",
      installationId: "2",
      privateKey: "pem",
    });
  });

  it("rejects an empty required host with an inline error, not a passthrough", () => {
    const payload = buildCreatePayload(
      GITHUB_ENTERPRISE_APP_TEMPLATE,
      values({
        host: "",
        appId: "1",
        installationId: "2",
        privateKey: "pem",
      }),
    );
    expect(payload).toEqual({ error: "Host is required" });
  });

  it("includes the host once supplied", () => {
    const payload = buildCreatePayload(
      GITHUB_ENTERPRISE_APP_TEMPLATE,
      values({
        host: "ghe.acme.com",
        appId: "1",
        installationId: "2",
        privateKey: "pem",
      }),
    );
    expect(payload).toMatchObject({ host: "ghe.acme.com" });
  });

  it("does not require an empty host when it's only overridable (operator preset)", () => {
    const payload = buildCreatePayload(
      GITHUB_ENTERPRISE_APP_PRESET_TEMPLATE,
      values({ host: "", appId: "1", installationId: "2", privateKey: "pem" }),
    );
    expect(payload).not.toHaveProperty("error");
  });
});
