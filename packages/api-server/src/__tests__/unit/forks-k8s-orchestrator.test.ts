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
  foreignSub: toForeignSub("kc-user-42"),
  sessionId: "sess-1",
};

describe("buildForkConfigMap", () => {
  it("produces a ConfigMap with the fork labels", () => {
    const cm = buildForkConfigMap({ forkId: "fork-1", spec });

    expect(cm.metadata?.name).toBe("fork-1");
    expect(cm.metadata?.labels).toMatchObject({
      "agent-platform.ai/type": "agent-fork",
      "agent-platform.ai/instance": "inst-abc",
      "agent-platform.ai/fork-id": "fork-1",
    });

    const body = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
    expect(body).toEqual({
      version: "agent-platform.ai/v1",
      instance: "inst-abc",
      foreignSub: "kc-user-42",
      sessionId: "sess-1",
    });
  });

  it("omits sessionId when not provided", () => {
    const withoutSession: ForkSpec = {
      instanceId: "inst-abc",
      foreignSub: toForeignSub("kc-user-42"),
    };
    const cm = buildForkConfigMap({
      forkId: "fork-1",
      spec: withoutSession,
    });
    const body = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
    expect(body).not.toHaveProperty("sessionId");
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
          version: "agent-platform.ai/v1",
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
          version: "agent-platform.ai/v1",
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
          version: "agent-platform.ai/v1",
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
    async readNamespacedConfigMap(_req: { name: string }) {
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
      namespace: "platform-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec });
    expect(result.ok).toBe(true);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].metadata?.name).toBe("fork-1");
    expect(fake.created[0].metadata?.namespace).toBe("platform-agents");
  });

  it("createFork maps 409 into AlreadyExists", async () => {
    const fake = makeFakeApi([], { createError: { code: 409 } });
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "platform-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AlreadyExists");
  });

  it("createFork maps other errors into WriteFailed", async () => {
    const fake = makeFakeApi([], { createError: { code: 500 } });
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "platform-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WriteFailed");
  });

  it("watchStatus yields Ready then terminates", async () => {
    const pending = cm({ phase: "Pending" });
    const ready = cm({ phase: "Ready", podIP: "10.0.0.5", jobName: "fork-1" });
    const fake = makeFakeApi([pending, ready]);
    const orch = createK8sForkOrchestrator({
      api: fake.api,
      namespace: "platform-agents",
      sleep: async () => {},
    });

    const received = [];
    for await (const status of orch.watchStatus("fork-1"))
      received.push(status);

    expect(received).toEqual([
      { phase: "Pending" },
      { phase: "Ready", podIP: "10.0.0.5" },
    ]);
  });
});

function cm(status: Record<string, unknown>): k8s.V1ConfigMap {
  return {
    data: {
      "status.yaml": yaml.dump({ version: "agent-platform.ai/v1", ...status }),
    },
  } as k8s.V1ConfigMap;
}
