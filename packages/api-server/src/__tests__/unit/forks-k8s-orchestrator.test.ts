import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import {
  buildForkConfigMap,
  parseForkStatus,
} from "../../modules/forks/infrastructure/configmap-mappers.js";
import { createK8sForkOrchestrator } from "../../modules/forks/infrastructure/k8s-fork-orchestrator.js";
import type { ForkSpec } from "../../modules/forks/domain/fork.js";
import { toForeignSub } from "../../modules/forks/domain/fork.js";

const spec: ForkSpec = {
  instanceId: "inst-abc",
  foreignSub: toForeignSub("kc|user-42"),
  forkAgentIdentifier: "fork-inst-abc-abcd1234abcd",
  sessionId: "sess-1",
};

describe("buildForkConfigMap", () => {
  it("produces a ConfigMap with the fork labels and inlined access token", () => {
    const cm = buildForkConfigMap({ forkId: "fork-1", spec, accessToken: "tok" });

    expect(cm.metadata?.name).toBe("fork-1");
    expect(cm.metadata?.labels).toMatchObject({
      "humr.ai/type": "agent-fork",
      "humr.ai/instance": "inst-abc",
      "humr.ai/fork-id": "fork-1",
    });

    const body = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
    expect(body).toEqual({
      version: "humr.ai/v1",
      instance: "inst-abc",
      foreignSub: "kc|user-42",
      forkAgentIdentifier: "fork-inst-abc-abcd1234abcd",
      sessionId: "sess-1",
      accessToken: "tok",
    });
  });

  it("omits sessionId when not provided", () => {
    const withoutSession: ForkSpec = {
      instanceId: "inst-abc",
      foreignSub: toForeignSub("kc|user-42"),
      forkAgentIdentifier: "fork-inst-abc-abcd1234abcd",
    };
    const cm = buildForkConfigMap({
      forkId: "fork-1",
      spec: withoutSession,
      accessToken: "tok",
    });
    const body = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
    expect(body).not.toHaveProperty("sessionId");
  });

  // Envoy path (ADR-033): the api-server skips the OneCLI mint, so the
  // ConfigMap must omit `accessToken` and `forkAgentIdentifier`. The
  // controller resolves credentials from foreignSub-labeled K8s Secrets at
  // render time.
  it("omits accessToken and forkAgentIdentifier on the Envoy path", () => {
    const envoySpec: ForkSpec = {
      instanceId: "inst-abc",
      foreignSub: toForeignSub("kc|user-42"),
      forkAgentIdentifier: "",
    };
    const cm = buildForkConfigMap({ forkId: "fork-1", spec: envoySpec });
    const body = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
    expect(body).toEqual({
      version: "humr.ai/v1",
      instance: "inst-abc",
      foreignSub: "kc|user-42",
    });
    expect(body).not.toHaveProperty("accessToken");
    expect(body).not.toHaveProperty("forkAgentIdentifier");
  });
});

describe("parseForkStatus", () => {
  it("returns null when no status.yaml is present", () => {
    expect(parseForkStatus({ data: {} } as k8s.V1ConfigMap)).toBeNull();
  });

  it("parses a Ready status with podIP", () => {
    const cm = {
      data: {
        "status.yaml": yaml.dump({
          version: "humr.ai/v1",
          phase: "Ready",
          jobName: "fork-1",
          podIP: "10.0.0.5",
        }),
      },
    } as k8s.V1ConfigMap;
    expect(parseForkStatus(cm)).toEqual({ phase: "Ready", podIP: "10.0.0.5" });
  });

  it("parses a Failed status with a known reason", () => {
    const cm = {
      data: {
        "status.yaml": yaml.dump({
          version: "humr.ai/v1",
          phase: "Failed",
          error: { reason: "PodNotReady", detail: "CrashLoop" },
        }),
      },
    } as k8s.V1ConfigMap;
    expect(parseForkStatus(cm)).toEqual({
      phase: "Failed",
      error: { reason: "PodNotReady", detail: "CrashLoop" },
    });
  });

  it("drops an unknown reason so downstream stays strictly typed", () => {
    const cm = {
      data: {
        "status.yaml": yaml.dump({
          version: "humr.ai/v1",
          phase: "Failed",
          error: { reason: "SomethingElse" },
        }),
      },
    } as k8s.V1ConfigMap;
    expect(parseForkStatus(cm)).toEqual({ phase: "Failed" });
  });

  it("ignores an unknown phase", () => {
    const cm = {
      data: { "status.yaml": yaml.dump({ phase: "Weird" }) },
    } as k8s.V1ConfigMap;
    expect(parseForkStatus(cm)).toBeNull();
  });
});

interface FakeApi {
  created: k8s.V1ConfigMap[];
  deleted: string[];
  readSequence: Array<k8s.V1ConfigMap | "not-found">;
  readCount: number;
  createError?: { code: number };
  api: k8s.CoreV1Api;
}

function makeFakeApi(
  initialReads: Array<k8s.V1ConfigMap | "not-found">,
  opts: { createError?: { code: number } } = {},
): FakeApi {
  const state: FakeApi = {
    created: [],
    deleted: [],
    readSequence: initialReads,
    readCount: 0,
    createError: opts.createError,
    api: undefined as unknown as k8s.CoreV1Api,
  };
  const api = {
    async createNamespacedConfigMap(req: { body: k8s.V1ConfigMap }) {
      if (state.createError) throw state.createError;
      state.created.push(req.body);
      return req.body;
    },
    async readNamespacedConfigMap(req: { name: string }) {
      const idx = Math.min(state.readCount, state.readSequence.length - 1);
      state.readCount += 1;
      const entry = state.readSequence[idx];
      if (entry === "not-found") throw { code: 404 };
      return entry;
    },
    async deleteNamespacedConfigMap(req: { name: string }) {
      state.deleted.push(req.name);
      return {};
    },
  } as unknown as k8s.CoreV1Api;
  state.api = api;
  return state;
}

describe("createK8sForkOrchestrator", () => {
  it("createFork writes a ConfigMap and returns ok", async () => {
    const fake = makeFakeApi([]);
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "humr-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec, accessToken: "tok" });
    expect(result.ok).toBe(true);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].metadata?.name).toBe("fork-1");
    expect(fake.created[0].metadata?.namespace).toBe("humr-agents");
  });

  it("createFork maps 409 into AlreadyExists", async () => {
    const fake = makeFakeApi([], { createError: { code: 409 } });
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "humr-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec, accessToken: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AlreadyExists");
  });

  it("createFork maps other errors into WriteFailed", async () => {
    const fake = makeFakeApi([], { createError: { code: 500 } });
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "humr-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec, accessToken: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WriteFailed");
  });

  it("watchStatus yields Ready then terminates", async () => {
    const pending = cm({ phase: "Pending" });
    const ready = cm({ phase: "Ready", podIP: "10.0.0.5", jobName: "fork-1" });
    const fake = makeFakeApi([pending, ready]);
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "humr-agents",
      sleep: async () => {},
    });

    const received = [];
    for await (const status of orch.watchStatus("fork-1")) received.push(status);

    expect(received).toEqual([
      { phase: "Pending" },
      { phase: "Ready", podIP: "10.0.0.5" },
    ]);
  });

  it("watchStatus terminates when ConfigMap is 404", async () => {
    const fake = makeFakeApi(["not-found"]);
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "humr-agents",
      sleep: async () => {},
    });

    const received = [];
    for await (const status of orch.watchStatus("fork-1")) received.push(status);

    expect(received).toEqual([]);
  });

  it("deleteFork issues a delete and swallows 404", async () => {
    const fake = makeFakeApi([]);
    fake.api.deleteNamespacedConfigMap = async () => {
      throw { code: 404 };
    };
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "humr-agents",
      sleep: async () => {},
    });
    await expect(orch.deleteFork("fork-1")).resolves.toBeUndefined();
  });
});

function cm(status: Record<string, unknown>): k8s.V1ConfigMap {
  return {
    metadata: { name: "fork-1" },
    data: { "status.yaml": yaml.dump(status) },
  } as k8s.V1ConfigMap;
}
