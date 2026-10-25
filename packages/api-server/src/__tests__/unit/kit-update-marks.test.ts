// TEST_OVERVIEW: the reminder mark a Kit Update gets is a compare-and-set on the store: it lands only while the pending mark is still the one the reminder read, so a report that lands in between wins and no cleared update comes back.
import { describe, expect, it } from "vitest";

import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { ANN_KIT_UPDATE_PENDING } from "../../modules/agents/infrastructure/labels.js";

const NEW = "b".repeat(40);
const AT = "2026-10-20T11:00:00.000Z";

function agent(pending: Record<string, string> | null): KubeObject {
  return {
    metadata: {
      name: "agent-1",
      labels: { "agent-platform.ai/owner": "owner-1" },
      resourceVersion: "41",
      annotations: pending
        ? { [ANN_KIT_UPDATE_PENDING]: JSON.stringify(pending) }
        : {},
    },
    spec: { name: "agent-1" },
  } as KubeObject;
}

const PENDING = {
  targetCommit: NEW,
  startedAt: "2026-10-20T10:00:00.000Z",
};

function conflict(name: string): Error {
  return Object.assign(new Error(`409: ${name}`), { code: 409 });
}

/** TEST_SCENARIO: the fixture for the two cases below — an API server that enforces `metadata.resourceVersion`, and can run a write from someone else before it answers the next patch, which is the report that lands in the reminder's read-to-write window.
 */
function apiServer(initial: KubeObject) {
  let stored = initial;
  let beforePatch: ((current: KubeObject) => KubeObject) | null = null;
  const client: K8sClient = {
    namespace: "test-agents",
    watchCustomObjects() {
      return () => {};
    },
    async getCustomObject() {
      return structuredClone(stored);
    },
    async listCustomObjects() {
      return [structuredClone(stored)];
    },
    async createCustomObject(_plural, body) {
      stored = body as KubeObject;
      return stored;
    },
    async patchCustomObject(_plural, name, body) {
      if (beforePatch) {
        const write = beforePatch;
        beforePatch = null;
        stored = write(stored);
      }
      const patch = body as KubeObject;
      const sent = patch.metadata?.resourceVersion;
      if (sent !== undefined && sent !== stored.metadata?.resourceVersion)
        throw conflict(name);
      stored = {
        ...stored,
        metadata: {
          ...stored.metadata,
          annotations: {
            ...stored.metadata?.annotations,
            ...patch.metadata?.annotations,
          },
          resourceVersion: String(
            Number(stored.metadata?.resourceVersion ?? 0) + 1,
          ),
        },
      };
      return stored;
    },
    async deleteCustomObject() {},
    listSecrets: () => Promise.reject(new Error("not implemented")),
    getSecret: () => Promise.reject(new Error("not implemented")),
    createSecret: () => Promise.reject(new Error("not implemented")),
    replaceSecret: () => Promise.reject(new Error("not implemented")),
    deleteSecret: () => Promise.reject(new Error("not implemented")),
  };
  return {
    client,
    writeBySomeoneElse(write: (current: KubeObject) => KubeObject) {
      beforePatch = write;
    },
    read: () => stored,
  };
}

function harness(initial: KubeObject) {
  const server = apiServer(initial);
  const repo = createAgentsRepository(
    server.client,
    createLiveAgentStateCache(server.client),
  );
  return { repo, server };
}

function pendingOf(obj: KubeObject) {
  const raw = obj.metadata?.annotations?.[ANN_KIT_UPDATE_PENDING];
  return raw === undefined ? null : JSON.parse(raw);
}

describe("nudgeKitUpdate", () => {
  // TEST_SCENARIO: the pending mark is still the one the reminder read, so the reminder lands against the version that read saw and records itself once.
  it("records the reminder while the pending mark is unchanged", async () => {
    const h = harness(agent(PENDING));

    const marked = await h.repo.nudgeKitUpdate("agent-1", NEW, AT);

    expect(marked).toBe(true);
    expect(pendingOf(h.server.read())).toEqual({ ...PENDING, nudgedAt: AT });
  });

  // TEST_SCENARIO: the agent reports the update between the reminder's read and its write. The report moves the version the reminder read, so the reminder conflicts and the update stays reported instead of coming back.
  it("loses to a report that lands between the read and the write", async () => {
    const h = harness(agent(PENDING));
    h.server.writeBySomeoneElse((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        annotations: {},
        resourceVersion: "42",
      },
    }));

    const marked = await h.repo.nudgeKitUpdate("agent-1", NEW, AT);

    expect(marked).toBe(false);
    expect(pendingOf(h.server.read())).toBe(null);
  });

  // TEST_SCENARIO: the update was retargeted, already reminded, or is gone. Nothing is written, so no mark comes back from the dead.
  it("writes nothing when the pending mark is no longer the one it read", async () => {
    for (const stored of [
      null,
      { ...PENDING, targetCommit: "c".repeat(40) },
      { ...PENDING, nudgedAt: AT },
    ]) {
      const h = harness(agent(stored));
      expect(await h.repo.nudgeKitUpdate("agent-1", NEW, AT)).toBe(false);
      expect(pendingOf(h.server.read())).toEqual(
        stored === null ? null : stored,
      );
    }
  });
});
