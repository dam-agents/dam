import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";

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
  it("emits an SDS DiscoveryResponse with the formatted credential as inline_string", () => {
    const yaml = sdsYamlContent("abc", "Bearer {value}");
    expect(yaml).toContain('"@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret');
    expect(yaml).toContain("name: credential");
    expect(yaml).toContain("generic_secret:");
    expect(yaml).toContain('inline_string: "Bearer abc"');
  });
  it("JSON-encodes the inline_string so quotes/newlines are safe in YAML", () => {
    const yaml = sdsYamlContent('weird"\nvalue', "{value}");
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
    expect(s.metadata?.name).toBe("humr-cred-abc");
    expect(s.metadata?.labels?.["humr.ai/owner"]).toBe("owner-1");
    expect(s.metadata?.labels?.["humr.ai/secret-type"]).toBe("anthropic");
    expect(s.metadata?.annotations?.["humr.ai/injection-header-name"]).toBe("x-api-key");
    expect(s.metadata?.annotations?.["humr.ai/auth-mode"]).toBe("api-key");
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
    expect(s.metadata?.annotations?.["humr.ai/injection-header-name"]).toBe("Authorization");
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
    expect(s.metadata?.annotations?.["humr.ai/injection-header-name"]).toBe("X-Auth");
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
    expect(s.metadata?.annotations?.["humr.ai/injection-header-name"]).toBe("Authorization");
    expect(s.stringData?.["sds.yaml"]).toContain('inline_string: "Bearer tok"');
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
    expect(replaced[0]!.body.metadata?.annotations?.["humr.ai/injection-header-name"]).toBe("x-api-key");
  });
});
