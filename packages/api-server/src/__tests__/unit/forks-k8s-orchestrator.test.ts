import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import {
  buildForkObject,
  parseForkStatus,
  type ForkObject,
} from "../../modules/forks/infrastructure/fork-mappers.js";
import { createK8sForkOrchestrator } from "../../modules/forks/infrastructure/k8s-fork-orchestrator.js";
import type { ForkSpec } from "../../modules/forks/domain/fork.js";
import { toForeignSub } from "../../modules/forks/domain/fork.js";

const spec: ForkSpec = {
  agentId: "inst-abc",
  foreignSub: toForeignSub("kc-user-42"),
  sessionId: "sess-1",
};

describe("buildForkObject", () => {
  it("produces a Fork custom resource with the fork labels", () => {
    const obj = buildForkObject({ forkId: "fork-1", spec });

    expect(obj.apiVersion).toBe("agent-platform.ai/v1");
    expect(obj.kind).toBe("Fork");
    expect(obj.metadata.name).toBe("fork-1");
    expect(obj.metadata.labels).toMatchObject({
      "agent-platform.ai/agent": "inst-abc",
      "agent-platform.ai/fork-id": "fork-1",
    });
    expect(obj.spec).toEqual({
      agentName: "inst-abc",
      foreignSub: "kc-user-42",
      sessionId: "sess-1",
    });
  });

  it("omits sessionId when not provided", () => {
    const withoutSession: ForkSpec = {
      agentId: "inst-abc",
      foreignSub: toForeignSub("kc-user-42"),
    };
    const obj = buildForkObject({ forkId: "fork-1", spec: withoutSession });
    expect(obj.spec).not.toHaveProperty("sessionId");
  });
});

describe("parseForkStatus", () => {
  it("returns null when no status is present", () => {
    expect(parseForkStatus({})).toBeNull();
  });

  it("parses a Ready status with podIP", () => {
    const obj = {
      status: { phase: "Ready", jobName: "fork-1", podIP: "10.0.0.5" },
    };
    expect(parseForkStatus(obj)).toEqual({ phase: "Ready", podIP: "10.0.0.5" });
  });

  it("parses a Failed status with a known reason", () => {
    const obj = {
      status: {
        phase: "Failed",
        error: { reason: "PodNotReady", detail: "CrashLoop" },
      },
    };
    expect(parseForkStatus(obj)).toEqual({
      phase: "Failed",
      error: { reason: "PodNotReady", detail: "CrashLoop" },
    });
  });

  it("drops an unknown reason so downstream stays strictly typed", () => {
    const obj = {
      status: { phase: "Failed", error: { reason: "SomethingElse" } },
    };
    expect(parseForkStatus(obj)).toEqual({ phase: "Failed" });
  });

  it("ignores an unknown phase", () => {
    expect(parseForkStatus({ status: { phase: "Weird" } })).toBeNull();
  });
});

interface FakeApi {
  created: unknown[];
  deleted: string[];
  readSequence: Array<ForkObject | "not-found">;
  readCount: number;
  createError?: { code: number };
  customObjects: k8s.CustomObjectsApi;
}

function makeFakeApi(
  initialReads: Array<ForkObject | "not-found">,
  opts: { createError?: { code: number } } = {},
): FakeApi {
  const state: FakeApi = {
    created: [],
    deleted: [],
    readSequence: initialReads,
    readCount: 0,
    createError: opts.createError,
    customObjects: undefined as unknown as k8s.CustomObjectsApi,
  };
  const customObjects = {
    async createNamespacedCustomObject(req: { body: unknown }) {
      if (state.createError) throw state.createError;
      state.created.push(req.body);
      return req.body;
    },
    async getNamespacedCustomObject(_req: { name: string }) {
      const idx = Math.min(state.readCount, state.readSequence.length - 1);
      state.readCount += 1;
      const entry = state.readSequence[idx];
      if (entry === "not-found") throw { code: 404 };
      return entry;
    },
    async deleteNamespacedCustomObject(req: { name: string }) {
      state.deleted.push(req.name);
      return {};
    },
  } as unknown as k8s.CustomObjectsApi;
  state.customObjects = customObjects;
  return state;
}

describe("createK8sForkOrchestrator", () => {
  it("createFork writes a Fork CR and returns ok", async () => {
    const fake = makeFakeApi([]);
    const orch = createK8sForkOrchestrator({
      customObjects: fake.customObjects,
      namespace: "platform-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec });
    expect(result.ok).toBe(true);
    expect(fake.created).toHaveLength(1);
    expect((fake.created[0] as ForkObject).metadata.name).toBe("fork-1");
    expect((fake.created[0] as ForkObject).kind).toBe("Fork");
  });

  it("createFork maps 409 into AlreadyExists", async () => {
    const fake = makeFakeApi([], { createError: { code: 409 } });
    const orch = createK8sForkOrchestrator({
      customObjects: fake.customObjects,
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
      customObjects: fake.customObjects,
      namespace: "platform-agents",
      sleep: async () => {},
    });
    const result = await orch.createFork({ forkId: "fork-1", spec });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WriteFailed");
  });

  it("watchStatus yields Ready then terminates", async () => {
    const pending = forkObj({ phase: "Pending" });
    const ready = forkObj({
      phase: "Ready",
      podIP: "10.0.0.5",
      jobName: "fork-1",
    });
    const fake = makeFakeApi([pending, ready]);
    const orch = createK8sForkOrchestrator({
      customObjects: fake.customObjects,
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

function forkObj(status: Record<string, unknown>): ForkObject {
  return {
    apiVersion: "agent-platform.ai/v1",
    kind: "Fork",
    metadata: { name: "fork-1" },
    spec: { agentName: "inst-abc", foreignSub: "kc-user-42" },
    status,
  };
}
