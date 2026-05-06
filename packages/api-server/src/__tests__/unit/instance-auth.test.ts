import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInstanceCredential } from "../../apps/harness-api-server/instance-auth.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

// In-memory K8sClient stub: only `getConfigMap` is exercised by the
// validator. Real client is a thin wrapper around the kubernetes-client SDK,
// not worth wiring up just for hash compares.
function fakeK8s(byName: Record<string, unknown>): K8sClient {
  return {
    getConfigMap: async (name: string) => byName[name] ?? null,
  } as unknown as K8sClient;
}

const TOKEN = "valid-token-1234567890";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

const INSTANCE_CM = {
  metadata: {
    name: "inst-1",
    labels: {
      "agent-platform.ai/agent": "agent-1",
      "agent-platform.ai/owner": "owner-A",
    },
  },
  data: {
    "status.yaml": `version: agent-platform.ai/v1
currentState: running
platformCredentialHash: ${TOKEN_HASH}
`,
  },
};
const AGENT_CM = {
  metadata: { name: "agent-1", labels: { "agent-platform.ai/owner": "owner-A" } },
  data: { "spec.yaml": "" },
};

describe("verifyInstanceCredential — issue #108", () => {
  it("accepts a matching `PlatformInstance <token>` and returns identity", async () => {
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "agent-1": AGENT_CM });
    const id = await verifyInstanceCredential(k8s, "inst-1", `PlatformInstance ${TOKEN}`);
    expect(id).toEqual({ instanceId: "inst-1", agentId: "agent-1", owner: "owner-A" });
  });

  it("rejects a missing Authorization header", async () => {
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "agent-1": AGENT_CM });
    expect(await verifyInstanceCredential(k8s, "inst-1", undefined)).toBeNull();
  });

  it("rejects the wrong scheme (legacy `Bearer` is gone)", async () => {
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "agent-1": AGENT_CM });
    expect(await verifyInstanceCredential(k8s, "inst-1", `Bearer ${TOKEN}`)).toBeNull();
  });

  it("rejects an empty token after the scheme prefix", async () => {
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "agent-1": AGENT_CM });
    expect(await verifyInstanceCredential(k8s, "inst-1", "PlatformInstance ")).toBeNull();
  });

  it("rejects a token that doesn't match the instance's hash", async () => {
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "agent-1": AGENT_CM });
    expect(await verifyInstanceCredential(k8s, "inst-1", "PlatformInstance wrong")).toBeNull();
  });

  it("rejects when the instance ConfigMap is missing", async () => {
    const k8s = fakeK8s({ "agent-1": AGENT_CM });
    expect(await verifyInstanceCredential(k8s, "missing", `PlatformInstance ${TOKEN}`)).toBeNull();
  });

  it("rejects when the instance status carries no platformCredentialHash", async () => {
    const noHashCM = {
      metadata: INSTANCE_CM.metadata,
      data: {
        "status.yaml": `version: agent-platform.ai/v1
currentState: running
`,
      },
    };
    const k8s = fakeK8s({ "inst-1": noHashCM, "agent-1": AGENT_CM });
    expect(await verifyInstanceCredential(k8s, "inst-1", `PlatformInstance ${TOKEN}`)).toBeNull();
  });

  it("rejects when the instance has been relabelled to a different owner's agent", async () => {
    const wrongOwnerAgent = {
      metadata: { name: "agent-1", labels: { "agent-platform.ai/owner": "owner-B" } },
      data: {},
    };
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "agent-1": wrongOwnerAgent });
    expect(await verifyInstanceCredential(k8s, "inst-1", `PlatformInstance ${TOKEN}`)).toBeNull();
  });

  it("cross-instance reuse: a token issued for inst-1 fails on inst-2", async () => {
    // Different instance, different hash — even a freshly minted token from
    // a sibling pair must not authenticate against another instance.
    const otherInstance = {
      metadata: {
        name: "inst-2",
        labels: { "agent-platform.ai/agent": "agent-1", "agent-platform.ai/owner": "owner-A" },
      },
      data: {
        "status.yaml": `version: agent-platform.ai/v1
currentState: running
platformCredentialHash: ${createHash("sha256").update("different-token").digest("hex")}
`,
      },
    };
    const k8s = fakeK8s({ "inst-1": INSTANCE_CM, "inst-2": otherInstance, "agent-1": AGENT_CM });
    // inst-1's token authenticates against inst-1...
    expect(await verifyInstanceCredential(k8s, "inst-1", `PlatformInstance ${TOKEN}`)).not.toBeNull();
    // ...but the same token does not authenticate against inst-2.
    expect(await verifyInstanceCredential(k8s, "inst-2", `PlatformInstance ${TOKEN}`)).toBeNull();
  });
});
