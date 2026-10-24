import { describe, it, expect } from "vitest";
import {
  mapAgent,
  mapBudget,
  previewAgentStore,
  type AgentStoreDefaults,
} from "../../modules/agent-store/preview.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";

// TEST_OVERVIEW: The dry-run absorb report is the operator's evidence that the switch is safe on an install, so the mapping it reports on is what the real absorb will write. These specs pin what a stored Agent becomes — values that must survive verbatim, the fields the move deliberately drops — and every refusal, because a refused Agent is one an operator has to look at before the switch rather than after.

const DEFAULTS: AgentStoreDefaults = { cpuLimit: "1", memoryLimit: "2Gi" };
const SWITCHED_AT = "2026-10-24T12:00:00.000Z";

const agent = (overrides: {
  name?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  uid?: string;
  generation?: number;
  deletionTimestamp?: string;
}): KubeObject => ({
  metadata: {
    name: overrides.name ?? "agent-abc",
    uid: overrides.uid ?? "0f8fad5b-d9cb-469f-a165-70867728950e",
    generation: overrides.generation ?? 7,
    labels: overrides.labels ?? { "agent-platform.ai/owner": "sub-1" },
    annotations: overrides.annotations ?? {},
    ...(overrides.deletionTimestamp
      ? { deletionTimestamp: overrides.deletionTimestamp }
      : {}),
  } as unknown as KubeObject["metadata"],
  spec: overrides.spec ?? { image: "agent:1" },
  status: overrides.status ?? {},
});

describe("agent mapping", () => {
  // TEST_SCENARIO: The columns that decide which machine runs feed a hash or a comparison, so their spelling has to survive the move: quantities stay text, the restart revision is copied, and the generation and uid are carried over so the second after the switch reads like the second before it.
  it("copies rendered values verbatim and keeps the observation's provenance", () => {
    const mapped = mapAgent(
      agent({
        annotations: {
          "agent-platform.ai/roll-rev": "rev-3",
          "agent-platform.ai/sweepable": "true",
          "agent-platform.ai/last-activity": "2026-10-24T10:00:00Z",
          "agent-platform.ai/active-session": "true",
          "agent-platform.ai/disabled": "true",
        },
        spec: {
          image: "agent:1",
          resources: { limits: { cpu: "1500m", memory: "6Gi" } },
          hibernationTimeout: "90m0s",
          l7Hosts: ["*.example.test"],
          storageSize: "3Gi",
          mounts: [{ path: "/home/agent/data", persist: true, size: "8Gi" }],
        },
        status: {
          observedGeneration: 7,
          agentPodRestarts: 2,
          agentPodRestartReason: "OOMKilled",
          conditions: [
            {
              type: "Ready",
              status: "True",
              reason: "Reconciled",
              message: "",
              observedGeneration: 7,
              lastTransitionTime: "2026-10-20T09:00:00Z",
            },
          ],
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );

    expect(mapped.refusal).toBeUndefined();
    const rows = mapped.rows as {
      agent: Record<string, unknown>;
      signals: Record<string, unknown>;
      status: Record<string, unknown>;
      conditions: Array<Record<string, unknown>>;
      hosts: Array<Record<string, unknown>>;
    };
    expect(rows.agent.cpuLimit).toBe("1500m");
    expect(rows.agent.memoryLimit).toBe("6Gi");
    expect(rows.agent.diskSize).toBe("8Gi");
    expect(rows.agent.hibernationTimeoutNs).toBe(90 * 60 * 1_000_000_000);
    expect(rows.agent.generation).toBe(7);
    expect(rows.agent.incarnation).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(rows.agent.ownerSub).toBe("sub-1");
    expect(rows.signals.rollRev).toBe("rev-3");
    expect(rows.signals.sessionPinned).toBe(true);
    expect(rows.signals.lastActivityAt).toBe("2026-10-24T10:00:00Z");
    expect(rows.status.observedGeneration).toBe(7);
    expect(rows.status.machineRestarts).toBe(2);
    expect(rows.conditions).toHaveLength(1);
    expect(rows.conditions[0]?.lastTransitionAt).toBe("2026-10-20T09:00:00Z");
    expect(rows.hosts).toEqual([
      { agentId: "agent-abc", host: "*.example.test" },
    ]);
  });

  // TEST_SCENARIO: A limit an Agent never set falls back to the chart's legacy value, because the column is not nullable and the machine today is sized from the same default.
  it("fills a missing limit from the chart's legacy default", () => {
    const mapped = mapAgent(agent({}), DEFAULTS, SWITCHED_AT);
    const row = (mapped.rows as { agent: Record<string, unknown> }).agent;
    expect(row.cpuLimit).toBe("1");
    expect(row.memoryLimit).toBe("2Gi");
  });

  // TEST_SCENARIO: The fields the move deliberately drops are counted so the report names them, and the two that could carry secrets — a plain env list and an init script — are named too, because the archive keeps them and the rows must not.
  it("counts the dead fields it would drop", () => {
    const mapped = mapAgent(
      agent({
        annotations: {
          "agent-platform.ai/operator-note": "keep an eye on this",
        },
        spec: {
          image: "agent:1",
          init: "echo hi",
          env: [{ name: "A", value: "B" }],
          resources: { limits: {}, requests: { cpu: "1" } },
          imagePullPolicy: "Always",
          storageClass: "fast",
          agentHome: "/home/agent",
          grantedSecretIds: ["secret-1"],
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );

    expect(new Set(mapped.dropped)).toEqual(
      new Set([
        "spec.init",
        "spec.env",
        "spec.resources.requests",
        "spec.imagePullPolicy",
        "spec.storageClass",
        "spec.agentHome",
        "spec.grantedSecretIds",
        "annotations.unknown",
      ]),
    );
  });

  // TEST_SCENARIO: A flag the custom resource carries without a timestamp has to become one, and the only moment known is the switch; the alternative is a disabled Agent that reads as enabled.
  it("stamps a flag-only marker with the switch's time", () => {
    const mapped = mapAgent(
      agent({ annotations: { "agent-platform.ai/disabled": "true" } }),
      DEFAULTS,
      SWITCHED_AT,
    );
    const signals = (mapped.rows as { signals: Record<string, unknown> })
      .signals;
    expect(signals.disabledAt).toBe(SWITCHED_AT);
    expect(signals.stopRequestedAt).toBeNull();
  });

  // TEST_SCENARIO: The switched record must be one the constraints accept, so anything the custom resource's admission let through but a row cannot hold is refused with its reason rather than repaired — a repaired Agent would be a different machine than the one running.
  it("refuses what cannot become a row, with the reason", () => {
    const cases: Array<[string, KubeObject]> = [
      [
        "a deleting resource",
        agent({ deletionTimestamp: "2026-10-24T00:00:00Z" }),
      ],
      ["a name no label can carry", agent({ name: "Agent_Uppercase" })],
      ["no owner label", agent({ labels: {} })],
      ["no uid", agent({ uid: "not-a-uid" })],
      ["no image", agent({ spec: {} })],
      [
        "a persisted mount outside HOME",
        agent({
          spec: {
            image: "agent:1",
            mounts: [{ path: "/var/data", persist: true }],
          },
        }),
      ],
      [
        "an L7 host that is not a hostname",
        agent({ spec: { image: "agent:1", l7Hosts: ['bad"host'] } }),
      ],
      [
        "more L7 hosts than the cap",
        agent({
          spec: {
            image: "agent:1",
            l7Hosts: Array.from({ length: 257 }, (_, i) => `h${i}.test`),
          },
        }),
      ],
      [
        "an unparseable hibernation timeout",
        agent({ spec: { image: "agent:1", hibernationTimeout: "soon" } }),
      ],
    ];

    for (const [name, cr] of cases) {
      const mapped = mapAgent(cr, DEFAULTS, SWITCHED_AT);
      expect(mapped.rows, name).toBeUndefined();
      expect(mapped.refusal, name).toBeTruthy();
    }
  });

  // TEST_SCENARIO: A persisted mount larger than the storage override is the size the disk floor must take, and vice versa: the winning string survives with no conversion, because the machine is sized from the same text today.
  it("takes the larger of the storage override and a persisted mount", () => {
    const larger = mapAgent(
      agent({
        spec: {
          image: "agent:1",
          storageSize: "3Gi",
          mounts: [{ path: "/home/agent/data", persist: true, size: "8Gi" }],
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(
      (larger.rows as { agent: Record<string, unknown> }).agent.diskSize,
    ).toBe("8Gi");

    const smaller = mapAgent(
      agent({
        spec: {
          image: "agent:1",
          storageSize: "10Gi",
          mounts: [{ path: "/home/agent/data", persist: true, size: "8Gi" }],
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(
      (smaller.rows as { agent: Record<string, unknown> }).agent.diskSize,
    ).toBe("10Gi");
  });
});

describe("budget mapping", () => {
  // TEST_SCENARIO: A budget field an operator never set stays NULL so it inherits the chart's value, and the row is keyed by the subject its owner label and machine names carry.
  it("leaves an unset field to the chart", () => {
    const mapped = mapBudget({
      metadata: { name: "budget-sub-1" },
      spec: { owner: "sub-1", memory: "16Gi" },
    } as unknown as KubeObject);
    expect(mapped.refusal).toBeUndefined();
    expect(mapped.row).toMatchObject({
      ownerSub: "sub-1",
      cpu: null,
      memory: "16Gi",
      storage: null,
      setBySub: null,
    });
  });

  // TEST_SCENARIO: An operator-written budget that carries no override is a state the custom resource admits and the platform treats as absent, so the move deletes it rather than inventing a row; a value that is not a quantity is refused instead.
  it("refuses an empty budget and an unparseable one", () => {
    const empty = mapBudget({
      metadata: { name: "budget-sub-1" },
      spec: { owner: "sub-1" },
    } as unknown as KubeObject);
    expect(empty.refusal).toContain("no override");

    const broken = mapBudget({
      metadata: { name: "budget-sub-1" },
      spec: { owner: "sub-1", cpu: "lots" },
    } as unknown as KubeObject);
    expect(broken.refusal).toContain("not a quantity");
  });
});

describe("absorb preview", () => {
  // TEST_SCENARIO: The grants are the gateway's current egress authority, so a difference in either direction is reported and left alone: taking the database's set would widen access at the switch, and taking the resource's would ignore a grant the owner was given.
  it("reports grant differences in both directions and changes nothing", () => {
    const preview = previewAgentStore({
      agents: [
        agent({
          spec: { image: "agent:1", grantedConnectionIds: ["only-cr"] },
        }),
        agent({
          name: "agent-def",
          spec: { image: "agent:1" },
          uid: "0f8fad5b-d9cb-469f-a165-70867728950f",
        }),
      ],
      budgets: [],
      grants: [
        { agentId: "agent-abc", connectionId: "only-sql" },
        { agentId: "agent-def", connectionId: "both" },
      ],
      defaults: DEFAULTS,
      switchedAt: SWITCHED_AT,
    });

    expect(preview.connectionGrants.onlyInResource).toEqual([
      { id: "agent-abc", reason: "granted only on the resource: only-cr" },
    ]);
    expect(preview.connectionGrants.onlyInDatabase).toEqual([
      { id: "agent-abc", reason: "granted only in the database: only-sql" },
      { id: "agent-def", reason: "granted only in the database: both" },
    ]);
  });

  // TEST_SCENARIO: The report's counts are what an operator reads first: how many records were seen, how many would become rows, and which were refused. A count that silently includes a refused record would let an install switch with an Agent missing.
  it("counts what would import and what would not", () => {
    const preview = previewAgentStore({
      agents: [
        agent({ spec: { image: "agent:1" } }),
        agent({ name: "agent-bad", labels: {}, spec: { image: "agent:1" } }),
      ],
      budgets: [
        {
          metadata: { name: "budget-sub-1" },
          spec: { owner: "sub-1", cpu: "2" },
        } as unknown as KubeObject,
        {
          metadata: { name: "budget-sub-2" },
          spec: { owner: "sub-2" },
        } as unknown as KubeObject,
      ],
      grants: [],
      defaults: DEFAULTS,
      switchedAt: SWITCHED_AT,
    });

    expect(preview.agents).toMatchObject({ seen: 2, importable: 1 });
    expect(preview.agents.refused[0]?.id).toBe("agent-bad");
    expect(preview.budgets).toMatchObject({ seen: 2, importable: 1 });
    expect(preview.budgets.refused[0]?.id).toBe("sub-2");
    expect(preview.agents.dropped).toEqual({});
  });
});

describe("preview against what the rows accept", () => {
  // TEST_SCENARIO: A negative timeout is admitted by the custom resource and the controller reads it as never hibernating, so the row carries zero — the same behaviour — and the report says it normalized rather than calling a running Agent invalid.
  it("normalizes a negative timeout to never rather than refusing it", () => {
    const mapped = mapAgent(
      agent({ spec: { image: "agent:1", hibernationTimeout: "-1s" } }),
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(mapped.refusal).toBeUndefined();
    expect(
      (mapped.rows as { agent: Record<string, unknown> }).agent
        .hibernationTimeoutNs,
    ).toBe(0);
    expect(mapped.normalized).toContain("hibernationTimeout.negative");
  });

  // TEST_SCENARIO: The custom resource admits duplicate L7 hosts and the row's key cannot, so the mapper dedupes — the gateway renders a set either way — and counts it.
  it("dedupes the L7 hosts the row cannot repeat", () => {
    const mapped = mapAgent(
      agent({
        spec: { image: "agent:1", l7Hosts: ["a.test", "a.test", "b.test"] },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(mapped.normalized).toContain("l7Hosts.duplicates");
    expect((mapped.rows as { hosts: unknown[] }).hosts).toHaveLength(2);
  });

  // TEST_SCENARIO: The kit's commit checks accept uppercase and the columns accept lowercase; a half-written seed or pending update cannot be a row at all, so it is dropped and counted rather than failing the import.
  it("lowercases kit commits and drops an incomplete pair", () => {
    const mapped = mapAgent(
      agent({
        annotations: {
          "agent-platform.ai/starter-kit": "kit",
          "agent-platform.ai/starter-kit-seed": JSON.stringify({
            url: "https://github.com/acme/x",
            commit: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
          }),
          "agent-platform.ai/kit-update-pending": JSON.stringify({
            startedAt: "2026-10-20T00:00:00Z",
          }),
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    const kit = (mapped.rows as { kit: Record<string, unknown> }).kit;
    expect(kit.seedCommit).toBe("abcdef0123456789abcdef0123456789abcdef01");
    expect(kit.pendingCommit).toBeNull();
    expect(mapped.normalized).toEqual(
      expect.arrayContaining([
        "kitState.commitCase",
        "kitState.droppedPending",
      ]),
    );
  });

  // TEST_SCENARIO: The controller compares quantities as Kubernetes does, so a decimal gigabyte is smaller than a binary one; a comparison that mixed the two scales would report the wrong disk and size a machine differently. A persisted mount size the renderer cannot parse is a refusal, not a silent skip.
  it("compares quantities on one scale", () => {
    const decimal = mapAgent(
      agent({
        spec: {
          image: "agent:1",
          storageSize: "1G",
          mounts: [{ path: "/home/agent/data", persist: true, size: "2Gi" }],
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(
      (decimal.rows as { agent: Record<string, unknown> }).agent.diskSize,
    ).toBe("2Gi");

    const unparseable = mapAgent(
      agent({
        spec: {
          image: "agent:1",
          mounts: [{ path: "/home/agent/data", persist: true, size: "lots" }],
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    expect(unparseable.refusal).toBeTruthy();
  });

  // TEST_SCENARIO: The controller keeps its machine bookkeeping on annotations — when a machine came up or went down, an outstanding memory wait, and the OOM kill it recovered from. Those are not dead operator keys: losing them would let a controller reattribute an old kill or read a waiting start as refused.
  it("carries the controller's own bookkeeping into the status row", () => {
    const mapped = mapAgent(
      agent({
        annotations: {
          "agent-platform.ai/machine-up-at": "2026-10-24T08:00:00Z",
          "agent-platform.ai/machine-down-at": "2026-10-24T09:00:00Z",
          "agent-platform.ai/memory-wait-until": "2026-10-24T09:30:00Z",
          "agent-platform.ai/runner-oom-kill": "runner-1",
          "agent-platform.ai/runner-oom-over": "runner-1",
        },
      }),
      DEFAULTS,
      SWITCHED_AT,
    );
    const status = (mapped.rows as { status: Record<string, unknown> }).status;
    expect(status).toMatchObject({
      machineUpAt: "2026-10-24T08:00:00Z",
      machineDownAt: "2026-10-24T09:00:00Z",
      memoryWaitUntil: "2026-10-24T09:30:00Z",
      runnerOomKillId: "runner-1",
      runnerOomRecoveredId: "runner-1",
    });
    expect(mapped.normalized).toEqual([]);
    expect(mapped.dropped).toEqual([]);
  });

  // TEST_SCENARIO: A budget written outside the platform records no operator and no time, so the row carries neither; inventing the creation timestamp would tell an auditor that an operator changed it then.
  it("invents no operator-update time for an absorbed budget", () => {
    const mapped = mapBudget({
      metadata: {
        name: "budget-sub-1",
        creationTimestamp: "2026-10-01T00:00:00Z",
      },
      spec: { owner: "sub-1", cpu: "2" },
    } as unknown as KubeObject);
    expect(mapped.row).toMatchObject({
      setBySub: null,
      operatorUpdatedAt: null,
    });
  });
});
