import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { updateSecretInputSchema } from "api-server-api";

import {
  createK8sSecretsPort,
  injectionFileContent,
  resolveInjection,
  sdsYamlContent,
} from "../../modules/secrets/infrastructure/k8s-secrets-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function fakeClient() {
  const created: k8s.V1Secret[] = [];
  const replaced: { name: string; body: k8s.V1Secret }[] = [];
  const deleted: string[] = [];
  const store = new Map<string, k8s.V1Secret>();
  const client: K8sClient = {
    namespace: "test-ns",
    listConfigMaps: async () => [],
    getConfigMap: async () => null,
    createConfigMap: async (b) => b,
    replaceConfigMap: async (_n, b) => b,
    patchConfigMap: async () => undefined,
    deleteConfigMap: async () => undefined,
    listSecrets: async () => Array.from(store.values()),
    getSecret: async (n) => store.get(n) ?? null,
    createSecret: async (body) => {
      created.push(body);
      store.set(body.metadata!.name!, body);
      return body;
    },
    replaceSecret: async (n, body) => {
      replaced.push({ name: n, body });
      store.set(n, body);
      return body;
    },
    deleteSecret: async (n) => {
      deleted.push(n);
      store.delete(n);
    },
    listPods: async () => [],
    getPod: async () => null,
    patchPod: async () => undefined,
    deletePod: async () => false,
    listPVCs: async () => [],
    deletePVC: async () => undefined,
  };
  return { client, created, replaced, deleted, store };
}

describe("resolveInjection", () => {
  it("anthropic + api-key → x-api-key with bare value", () => {
    expect(resolveInjection("anthropic", "api-key", undefined)).toEqual({
      headerName: "x-api-key",
      valueFormat: "{value}",
    });
  });

  it("anthropic + oauth → Authorization: Bearer", () => {
    expect(resolveInjection("anthropic", "oauth", undefined)).toEqual({
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
  });

  it("anthropic with unknown auth mode falls back to OAuth-shape", () => {
    expect(resolveInjection("anthropic", undefined, undefined)).toEqual({
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
  });

  it("generic respects user-supplied valueFormat", () => {
    expect(resolveInjection("generic", undefined, { headerName: "Token", valueFormat: "Token {value}" })).toEqual({
      headerName: "Token",
      valueFormat: "Token {value}",
    });
  });

  it("generic defaults to Authorization: Bearer when no injectionConfig", () => {
    expect(resolveInjection("generic", undefined, undefined)).toEqual({
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
  });

  it("query-param injection still resolves the default Bearer valueFormat", () => {
    // The valueFormat default doesn't depend on queryParamName — the
    // controller's per-route Lua filter is what actually moves the
    // (bare-stored, see sdsInlineString) value into the URL. Confirm
    // resolveInjection doesn't accidentally branch on it.
    expect(
      resolveInjection("generic", undefined, {
        headerName: "X-Bob-Internal",
        queryParamName: "key",
      }),
    ).toEqual({
      headerName: "X-Bob-Internal",
      valueFormat: "Bearer {value}",
    });
  });
});

describe("injectionFileContent", () => {
  it("substitutes {value} verbatim", () => {
    expect(injectionFileContent("abc", "Bearer {value}")).toBe("Bearer abc");
  });
  it("returns the bare value when format is just {value}", () => {
    expect(injectionFileContent("abc", "{value}")).toBe("abc");
  });
  it("handles multiple substitutions", () => {
    expect(injectionFileContent("x", "{value}-{value}")).toBe("x-x");
  });
});

describe("sdsYamlContent", () => {
  it("emits an SDS DiscoveryResponse with the supplied string as inline_string", () => {
    const yaml = sdsYamlContent("Bearer abc");
    expect(yaml).toContain('"@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret');
    expect(yaml).toContain("name: credential");
    expect(yaml).toContain("generic_secret:");
    expect(yaml).toContain('inline_string: "Bearer abc"');
  });
  it("JSON-encodes the inline_string so quotes/newlines are safe in YAML", () => {
    const yaml = sdsYamlContent('weird"\nvalue');
    expect(yaml).toContain('inline_string: "weird\\"\\nvalue"');
  });
});

describe("createK8sSecretsPort.createSecret", () => {
  it("anthropic api-key writes x-api-key header with bare value", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "abc",
      name: "Anthropic Key",
      type: "anthropic",
      value: "sk-ant-key",
      hostPattern: "api.anthropic.com",
      authMode: "api-key",
    });

    expect(created).toHaveLength(1);
    const s = created[0]!;
    expect(s.metadata?.name).toBe("platform-cred-abc");
    expect(s.metadata?.labels?.["agent-platform.ai/owner"]).toBe("owner-1");
    expect(s.metadata?.labels?.["agent-platform.ai/secret-type"]).toBe("anthropic");
    expect(s.metadata?.annotations?.["agent-platform.ai/injection-header-name"]).toBe("x-api-key");
    expect(s.metadata?.annotations?.["agent-platform.ai/auth-mode"]).toBe("api-key");
    expect(s.stringData?.["sds.yaml"]).toContain('inline_string: "sk-ant-key"');
    expect(s.stringData?.value).toBeUndefined();
  });

  it("anthropic oauth writes Authorization header with Bearer prefix", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "def",
      name: "Anthropic OAuth",
      type: "anthropic",
      value: "oauth-token",
      hostPattern: "api.anthropic.com",
      authMode: "oauth",
    });

    const s = created[0]!;
    expect(s.metadata?.annotations?.["agent-platform.ai/injection-header-name"]).toBe("Authorization");
    expect(s.stringData?.["sds.yaml"]).toContain('inline_string: "Bearer oauth-token"');
  });

  it("generic respects valueFormat with arbitrary header", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "ghi",
      name: "Internal Gateway",
      type: "generic",
      value: "raw-tok",
      hostPattern: "internal.example.com",
      injectionConfig: { headerName: "X-Auth", valueFormat: "Token {value}" },
    });

    const s = created[0]!;
    expect(s.metadata?.annotations?.["agent-platform.ai/injection-header-name"]).toBe("X-Auth");
    expect(s.stringData?.["sds.yaml"]).toContain('inline_string: "Token raw-tok"');
  });

  it("generic defaults to Authorization: Bearer when injectionConfig is omitted", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "jkl",
      name: "Generic Default",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
    });

    const s = created[0]!;
    expect(s.metadata?.annotations?.["agent-platform.ai/injection-header-name"]).toBe("Authorization");
    expect(s.stringData?.["sds.yaml"]).toContain('inline_string: "Bearer tok"');
  });
});

describe("createK8sSecretsPort.createSecret — envMappings", () => {
  it("stores envMappings as a JSON annotation", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "env1",
      name: "With Env",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
      envMappings: [{ envName: "MY_KEY", placeholder: "dummy-placeholder" }],
    });

    const ann = created[0]!.metadata?.annotations?.["agent-platform.ai/env-mappings"];
    expect(ann).toBe(JSON.stringify([{ envName: "MY_KEY", placeholder: "dummy-placeholder" }]));
  });

  it("omits envMappings annotation when array is empty", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "env2",
      name: "No Env",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
      envMappings: [],
    });

    expect(created[0]!.metadata?.annotations?.["agent-platform.ai/env-mappings"]).toBeUndefined();
  });
});

describe("createK8sSecretsPort.listSecrets — envMappings", () => {
  it("returns envMappings from the annotation", async () => {
    const { client } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "env3",
      name: "Listed",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
      envMappings: [{ envName: "FOO", placeholder: "ph" }],
    });

    const secrets = await port.listSecrets();
    const found = secrets.find((s) => s.id === "env3");
    expect(found?.envMappings).toEqual([{ envName: "FOO", placeholder: "ph" }]);
  });

  it("returns no envMappings when annotation is absent", async () => {
    const { client } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "env4",
      name: "Plain",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
    });

    const secrets = await port.listSecrets();
    const found = secrets.find((s) => s.id === "env4");
    expect(found?.envMappings).toBeUndefined();
  });
});

describe("createK8sSecretsPort — queryParamName injection", () => {
  it("persists queryParamName as an annotation on create", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "bob",
      name: "Bob API key",
      type: "generic",
      value: "sk-real-key",
      hostPattern: "prod.ibm-bob-staging.cloud.ibm.com",
      injectionConfig: {
        headerName: "X-Bobshell-Credential",
        valueFormat: "{value}",
        queryParamName: "key",
      },
    });

    const ann = created[0]!.metadata?.annotations ?? {};
    expect(ann["agent-platform.ai/injection-query-param"]).toBe("key");
    expect(ann["agent-platform.ai/injection-header-name"]).toBe("X-Bobshell-Credential");
  });

  it("round-trips queryParamName through listSecrets", async () => {
    const { client } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "bob",
      name: "Bob",
      type: "generic",
      value: "sk-x",
      hostPattern: "prod.ibm-bob-staging.cloud.ibm.com",
      injectionConfig: {
        headerName: "X-Bobshell-Credential",
        valueFormat: "{value}",
        queryParamName: "key",
      },
    });

    const found = (await port.listSecrets()).find((s) => s.id === "bob");
    expect(found?.injectionConfig).toEqual({
      headerName: "X-Bobshell-Credential",
      valueFormat: "{value}",
      queryParamName: "key",
    });
  });

  it("omits ANN_VALUE_FORMAT for query-only secrets when valueFormat is not explicit", async () => {
    // For query-injection the Lua filter ignores valueFormat (SDS holds
    // the bare value), so stamping the resolved default `Bearer {value}`
    // would mislead anyone reading the raw K8s Secret.
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "bob",
      name: "Bob",
      type: "generic",
      value: "sk-x",
      hostPattern: "prod.ibm-bob-staging.cloud.ibm.com",
      injectionConfig: {
        headerName: "X-Bobshell-Credential",
        queryParamName: "key",
      },
    });

    const ann = created[0]!.metadata?.annotations ?? {};
    expect(ann["agent-platform.ai/injection-query-param"]).toBe("key");
    expect(ann["agent-platform.ai/injection-value-format"]).toBeUndefined();
  });

  it("keeps ANN_VALUE_FORMAT for query-only secrets when valueFormat is explicit", async () => {
    const { client, created } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "bob",
      name: "Bob",
      type: "generic",
      value: "sk-x",
      hostPattern: "prod.ibm-bob-staging.cloud.ibm.com",
      injectionConfig: {
        headerName: "X-Bobshell-Credential",
        valueFormat: "Custom {value}",
        queryParamName: "key",
      },
    });

    const ann = created[0]!.metadata?.annotations ?? {};
    expect(ann["agent-platform.ai/injection-value-format"]).toBe("Custom {value}");
  });

  it("drops the annotation when injectionConfig is reset to null", async () => {
    const { client, replaced } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "bob",
      name: "Bob",
      type: "generic",
      value: "sk-x",
      hostPattern: "prod.ibm-bob-staging.cloud.ibm.com",
      injectionConfig: {
        headerName: "X-Bobshell-Credential",
        valueFormat: "{value}",
        queryParamName: "key",
      },
    });

    await port.updateSecret("bob", {
      value: "sk-y",
      injectionConfig: null,
    });

    const ann = replaced[0]!.body.metadata?.annotations ?? {};
    expect(ann["agent-platform.ai/injection-query-param"]).toBeUndefined();
  });
});

describe("createK8sSecretsPort.updateSecret", () => {
  it("re-bakes the file content when value changes, preserving stored authMode", async () => {
    const { client, replaced } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "abc",
      name: "Anthropic",
      type: "anthropic",
      value: "old",
      hostPattern: "api.anthropic.com",
      authMode: "api-key",
    });

    await port.updateSecret("abc", { value: "new" });

    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.body.stringData?.["sds.yaml"]).toContain('inline_string: "new"');
    expect(replaced[0]!.body.metadata?.annotations?.["agent-platform.ai/injection-header-name"]).toBe("x-api-key");
  });

  it("persists envMappings on update", async () => {
    const { client, replaced } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "upd1",
      name: "Secret",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
    });

    await port.updateSecret("upd1", {
      envMappings: [{ envName: "NEW_VAR", placeholder: "ph" }],
    });

    const ann = replaced[0]!.body.metadata?.annotations?.["agent-platform.ai/env-mappings"];
    expect(ann).toBe(JSON.stringify([{ envName: "NEW_VAR", placeholder: "ph" }]));
  });

  it("removes envMappings annotation when updated with empty array", async () => {
    const { client, replaced } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "upd2",
      name: "Secret",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
      envMappings: [{ envName: "OLD_VAR", placeholder: "ph" }],
    });

    await port.updateSecret("upd2", { envMappings: [] });

    expect(replaced[0]!.body.metadata?.annotations?.["agent-platform.ai/env-mappings"]).toBeUndefined();
  });

  it("updates display name", async () => {
    const { client, replaced } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "upd3",
      name: "Old Name",
      type: "generic",
      value: "tok",
      hostPattern: "api.example.com",
    });

    await port.updateSecret("upd3", { name: "New Name" });

    expect(replaced[0]!.body.metadata?.annotations?.["agent-platform.ai/display-name"]).toBe("New Name");
  });

  it("returns before/after stored views so callers can diff render-affecting fields", async () => {
    // ADR-040 fanout decides which side-effects to run by diffing before
    // and after. The port surfaces both so the service avoids a redundant
    // read.
    const { client } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "diff1",
      name: "Secret",
      type: "generic",
      value: "tok",
      hostPattern: "api.old.example",
      envMappings: [{ envName: "OLD", placeholder: "ph" }],
    });

    const result = await port.updateSecret("diff1", {
      hostPattern: "api.new.example",
      envMappings: [{ envName: "NEW", placeholder: "ph2" }],
    });

    expect(result).not.toBeNull();
    expect(result!.before.hostPattern).toBe("api.old.example");
    expect(result!.after.hostPattern).toBe("api.new.example");
    expect(result!.before.envMappings).toEqual([{ envName: "OLD", placeholder: "ph" }]);
    expect(result!.after.envMappings).toEqual([{ envName: "NEW", placeholder: "ph2" }]);
  });

  it("returns null when the secret is not found", async () => {
    const { client } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");
    const result = await port.updateSecret("missing", { name: "Whatever" });
    expect(result).toBeNull();
  });

  it("re-bakes the SDS file with the new format when value+injectionConfig are patched together", async () => {
    const { client, replaced } = fakeClient();
    const port = createK8sSecretsPort(client, "owner-1");

    await port.createSecret({
      id: "rebake",
      name: "GitHub PAT",
      type: "generic",
      value: "old-pat",
      hostPattern: "github.com",
      injectionConfig: { headerName: "Authorization", valueFormat: "Bearer {value}" },
    });

    await port.updateSecret("rebake", {
      value: "new-pat",
      injectionConfig: { headerName: "Authorization", valueFormat: "Basic {value}" },
    });

    expect(replaced[0]!.body.stringData?.["sds.yaml"]).toContain('inline_string: "Basic new-pat"');
    expect(replaced[0]!.body.metadata?.annotations?.["agent-platform.ai/injection-value-format"]).toBe(
      "Basic {value}",
    );
  });
});

describe("updateSecretInputSchema", () => {
  it("accepts a value-only patch", () => {
    expect(updateSecretInputSchema.safeParse({ id: "abc", value: "tok" }).success).toBe(true);
  });

  it("accepts injectionConfig + value together", () => {
    const r = updateSecretInputSchema.safeParse({
      id: "abc",
      value: "tok",
      injectionConfig: { headerName: "Authorization", valueFormat: "Basic {value}" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an injectionConfig change without value", () => {
    const r = updateSecretInputSchema.safeParse({
      id: "abc",
      injectionConfig: { headerName: "Authorization", valueFormat: "Basic {value}" },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(["value"]);
      expect(r.error.issues[0]!.message).toMatch(/value is required/);
    }
  });

  it("rejects a clear-injectionConfig (null) without value", () => {
    const r = updateSecretInputSchema.safeParse({ id: "abc", injectionConfig: null });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(["value"]);
    }
  });
});
