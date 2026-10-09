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

const GITHUB_APP_SCOPED_TEMPLATE: ConnectionTemplateView = {
  ...GITHUB_APP_TEMPLATE,
  inputs: [
    ...GITHUB_APP_TEMPLATE.inputs,
    { name: "repositories", state: "optional" },
    { name: "permissions", state: "optional" },
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

  it("carries the scope fields when the user fills them", () => {
    const payload = buildCreatePayload(
      GITHUB_APP_SCOPED_TEMPLATE,
      values({
        appId: "1",
        installationId: "2",
        privateKey: "pem",
        repositories: "docs",
        permissions: "contents:read",
      }),
    );
    expect(payload).toEqual({
      templateId: "github-app",
      name: "my-connection",
      authKind: "github-app",
      appId: "1",
      installationId: "2",
      privateKey: "pem",
      repositories: "docs",
      permissions: "contents:read",
    });
  });

  it("omits the scope fields when the user leaves them blank", () => {
    const payload = buildCreatePayload(
      GITHUB_APP_SCOPED_TEMPLATE,
      values({
        appId: "1",
        installationId: "2",
        privateKey: "pem",
        repositories: "   ",
        permissions: "",
      }),
    );
    expect(payload).not.toHaveProperty("repositories");
    expect(payload).not.toHaveProperty("permissions");
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

const CUSTOM_HEADER_TEMPLATE: ConnectionTemplateView = {
  id: "custom-header",
  name: "Custom header",
  category: "other",
  isCustom: true,
  authKind: "header",
  inputs: [
    { name: "host", state: "required" },
    { name: "headerName", state: "required" },
    { name: "valueFormat", state: "optional" },
    { name: "value", state: "required", secret: true },
  ],
};

describe("buildCreatePayload (header)", () => {
  // TEST_SCENARIO: the gateway crash-loops on a bare * host or a header name that is not an HTTP token, and a value format without {value} never sends the secret, so the form must refuse each one before it reaches the API.
  it.each([
    [{ host: "*" }, /host must be a DNS hostname/],
    [{ host: "exa mple.com" }, /host must be a DNS hostname/],
    [{ headerName: "Bad Header:" }, /header name must be/],
    [{ valueFormat: "Bearer" }, /must contain \{value\}/],
  ])("refuses %o", (override, message) => {
    const payload = buildCreatePayload(
      CUSTOM_HEADER_TEMPLATE,
      values({
        host: "api.example.com",
        headerName: "X-Api-Key",
        value: "secret",
        ...override,
      }),
    );
    expect(payload).toEqual({ error: expect.stringMatching(message) });
  });

  it("accepts a *.wildcard host with a Bearer {value} format", () => {
    const payload = buildCreatePayload(
      CUSTOM_HEADER_TEMPLATE,
      values({
        host: "*.example.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
        value: "secret",
      }),
    );
    expect(payload).not.toHaveProperty("error");
  });
});
