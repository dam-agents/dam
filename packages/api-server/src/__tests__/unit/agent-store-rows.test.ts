import { describe, it, expect } from "vitest";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import {
  resourceFromRows,
  rowsFromResource,
} from "../../modules/agent-store/rows.js";

// TEST_OVERVIEW: the mapping module is the only place an Agent crosses between the shape the platform reads and the rows that hold it, in both directions. The dry-run report reads it one way and every Postgres adapter reads it the other, so a field that survives one direction and not the other would make the report's promise and the switch's result disagree. These specs pin the round trip, the values that must survive verbatim, and the ones the move deliberately drops.

const DEFAULTS = { cpuLimit: "1", memoryLimit: "2Gi" };
const SWITCHED_AT = "2026-10-24T12:00:00.000Z";

const stored: KubeObject = {
  metadata: {
    name: "agent-abc",
    uid: "0f8fad5b-d9cb-469f-a165-70867728950e",
    generation: 12,
    creationTimestamp: "2026-10-01T08:00:00Z",
    labels: {
      "agent-platform.ai/owner": "sub-1",
      "agent-platform.ai/template": "tpl-1",
    },
    annotations: {
      "agent-platform.ai/last-activity": "2026-10-24T10:00:00Z",
      "agent-platform.ai/stop-requested": "2026-10-24T10:05:00Z",
      "agent-platform.ai/roll-rev": "rev-7",
      "agent-platform.ai/sweepable": "true",
      "agent-platform.ai/lifetime-ms": "3600000",
      "agent-platform.ai/agent-kind": "stock",
      "agent-platform.ai/kb-template": "kb-1",
      "agent-platform.ai/kb-share-roots": "/home/agent/work,/home/agent/notes",
      "agent-platform.ai/starter-kit": "python-service",
      "agent-platform.ai/starter-kit-onboarded": "2026-10-02T09:00:00Z",
      "agent-platform.ai/starter-kit-seed": JSON.stringify({
        url: "https://github.com/acme/kit",
        branch: "main",
        commit: "abcdef0123456789abcdef0123456789abcdef01",
      }),
      "agent-platform.ai/starter-kit-default-model": "claude",
      "agent-platform.ai/kit-update-pending": JSON.stringify({
        targetCommit: "0123456789abcdef0123456789abcdef01234567",
        startedAt: "2026-10-23T00:00:00Z",
        nudgedAt: "2026-10-23T00:30:00Z",
      }),
      "agent-platform.ai/image-update-from": "agent:0",
      "agent-platform.ai/machine-up-at": "2026-10-24T09:00:00Z",
      "agent-platform.ai/runner-oom-kill": "runner-2",
    },
  } as unknown as KubeObject["metadata"],
  spec: {
    image: "agent:1",
    name: "Doc helper",
    description: "writes the docs",
    harness: "claude-code",
    hibernationTimeout: "90m0s",
    resources: { limits: { cpu: "1500m", memory: "6Gi" } },
    storageSize: "20Gi",
    backend: { type: "vm", vm: { nestedVirtualization: true } },
    requireConnectionAddress: true,
    telemetryAttributionId: "agent-root",
    secretRef: "agent-secrets",
    imagePullSecretRef: "registry-pull",
    l7Hosts: ["*.example.test", "api.example.test"],
    grantedConnectionIds: ["conn-1", "conn-2"],
  },
  status: {
    observedGeneration: 12,
    agentPodRestarts: 2,
    agentPodRestartReason: "OOMKilled",
    conditions: [
      {
        type: "Ready",
        status: "False",
        reason: "Hibernated",
        message: "",
        observedGeneration: 12,
        lastTransitionTime: "2026-10-24T10:06:00Z",
      },
    ],
  } as unknown as KubeObject["status"],
};

describe("an Agent crossing to rows and back", () => {
  // TEST_SCENARIO: The api-server's readers, its tRPC contracts and the UI read one Agent; after the switch they must read the same one from rows. Every field a reader decides from has to survive both directions, including the ones only the controller writes.
  it("keeps everything a reader decides from", () => {
    const mapped = rowsFromResource(stored, DEFAULTS, SWITCHED_AT);
    expect(mapped.refusal).toBeUndefined();

    const rebuilt = parseInfraAgent(resourceFromRows(mapped.rows!));
    const before = parseInfraAgent(stored);

    expect(rebuilt).toMatchObject({
      id: before.id,
      name: before.name,
      owner: before.owner,
      templateId: before.templateId,
      resourceVersion: "12",
      stopRequested: true,
      disabled: false,
      sweepable: true,
      lifetimeMs: 3_600_000,
      kbTemplateId: "kb-1",
      kbShareRoots: ["/home/agent/work", "/home/agent/notes"],
      starterKit: "python-service",
      starterKitDefaultModel: "claude",
      imageUpdateFrom: "agent:0",
      podRestarts: 2,
      podRestartReason: "OOMKilled",
    });
    expect(rebuilt.spec).toMatchObject({
      image: "agent:1",
      name: "Doc helper",
      description: "writes the docs",
      harness: "claude-code",
      resources: { limits: { cpu: "1500m", memory: "6Gi" } },
      storageSize: "20Gi",
      backend: { type: "vm", vm: { nestedVirtualization: true } },
      requireConnectionAddress: true,
      telemetryAttributionId: "agent-root",
      secretRef: "agent-secrets",
      imagePullSecretRef: "registry-pull",
      l7Hosts: ["*.example.test", "api.example.test"],
      grantedConnectionIds: ["conn-1", "conn-2"],
    });
    expect(rebuilt.starterKitSeed).toEqual(before.starterKitSeed);
    expect(rebuilt.kitUpdatePending?.targetCommit).toBe(
      before.kitUpdatePending?.targetCommit,
    );
    expect(new Date(rebuilt.kitUpdatePending!.startedAt).toISOString()).toBe(
      new Date(before.kitUpdatePending!.startedAt).toISOString(),
    );
    expect(new Date(rebuilt.kitUpdatePending!.nudgedAt!).toISOString()).toBe(
      new Date(before.kitUpdatePending!.nudgedAt!).toISOString(),
    );
    expect(rebuilt.hibernated).toBe(true);
    expect(rebuilt.hibernatedSince?.toISOString()).toBe(
      new Date("2026-10-24T10:06:00Z").toISOString(),
    );
    expect(rebuilt.quietSince?.toISOString()).toBe(
      new Date("2026-10-24T10:00:00Z").toISOString(),
    );
  });

  // TEST_SCENARIO: A reclaim mark names the activity it was stamped for by its token, and the controller's compare-and-set needs a token to consume. Every row written with an activity — a create's now, an absorbed Agent's stamp — must carry one, or the idle machine that a refused start needs room from can never be put to sleep. A row with no activity keeps no token.
  it("mints an activity token for every activity it writes", () => {
    const mapped = rowsFromResource(stored, DEFAULTS, SWITCHED_AT);
    expect(mapped.rows!.signals.lastActivityAt).not.toBeNull();
    expect(mapped.rows!.signals.lastActivityToken).toMatch(/^[0-9a-f-]{36}$/);

    const quiet = rowsFromResource(
      {
        ...stored,
        metadata: {
          ...stored.metadata,
          annotations: {},
        },
      } as KubeObject,
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(quiet.rows!.signals.lastActivityAt).toBeNull();
    expect(quiet.rows!.signals.lastActivityToken).toBeNull();
  });

  // TEST_SCENARIO: The reclaim mark is the controller's column alone, so the api-server's mapping does not carry it; a rebuilt Agent reads as never reclaimed until the controller marks it again. The report says so rather than letting a reader assume the mark survived.
  it("drops the reclaim mark and counts it", () => {
    const mapped = rowsFromResource(
      {
        ...stored,
        metadata: {
          ...stored.metadata,
          annotations: {
            ...stored.metadata?.annotations,
            "agent-platform.ai/reclaimed-at": "2026-10-24T10:07:00Z",
          },
        },
      } as KubeObject,
      DEFAULTS,
      SWITCHED_AT,
    );

    expect(mapped.normalized).toContain("reclaimMark.dropped");
    expect(
      parseInfraAgent(resourceFromRows(mapped.rows!)).reclaimed,
    ).toBeUndefined();
  });

  // TEST_SCENARIO: The idle timeout is stored as nanoseconds and read back as Go's duration text; a reader turns that text into minutes, so every form the platform accepts has to come back as the same duration, including the timeout that means never.
  it("rebuilds the idle timeout from nanoseconds", () => {
    for (const [raw, expected] of [
      ["90m0s", "1h30m0s"],
      ["0s", "0s"],
      ["1h0m0s", "1h0m0s"],
      ["2m30s", "2m30s"],
      ["1m0s", "1m0s"],
      ["3600s", "1h0m0s"],
    ] as const) {
      const rows = rowsFromResource(
        {
          ...stored,
          spec: {
            ...(stored.spec as Record<string, unknown>),
            hibernationTimeout: raw,
          },
        } as KubeObject,
        DEFAULTS,
        SWITCHED_AT,
      ).rows!;
      expect(
        parseInfraAgent(resourceFromRows(rows)).spec.hibernationTimeout,
        raw,
      ).toBe(expected);
    }
  });

  // TEST_SCENARIO: A row set is built by the writer, so the mapping's output must be insertable as it stands: the definition's own columns carry no child rows, and the children are the strings and records a writer turns into rows.
  it("separates the definition from its children", () => {
    const rows = rowsFromResource(stored, DEFAULTS, SWITCHED_AT).rows!;

    expect(rows.agent.id).toBe("agent-abc");
    expect(rows.agent.incarnation).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(rows.hosts).toEqual(["*.example.test", "api.example.test"]);
    expect(rows.grants).toEqual(["conn-1", "conn-2"]);
    expect(rows.kit?.agentId).toBe("agent-abc");
    expect(rows.conditions).toHaveLength(1);
    expect(rows.status?.machineRestarts).toBe(2);
  });
});
