import { describe, it, expect } from "vitest";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import {
  absentAbsorbedResources,
  attestedDigestMatches,
  restoreBody,
  rePointAction,
  rollbackVerdict,
  snapshotMembership,
  statusBody,
} from "../../modules/agent-store/rollback.js";
import { frozenRefusals } from "../../modules/agent-store/frozen.js";
import { rowsFromResource } from "../../modules/agent-store/rows.js";
import {
  buildAgentStoreSnapshot,
  orderDocuments,
} from "../../modules/agent-store/snapshot.js";
import { exportCrds, sha256Of } from "../../modules/agent-store/exporter.js";

// TEST_OVERVIEW: the rollback's decisions and the objects it writes. A rerun, a
// TEST_OVERVIEW: wrong database and an empty store must never turn into deleting every
// TEST_OVERVIEW: custom resource; the restore must write what the rows hold, including the
// TEST_OVERVIEW: fields cleared after the switch; and the freeze must be read from the cluster.

const DEFAULTS = { cpuLimit: "1", memoryLimit: "2Gi" };
const AT = "2026-10-24T12:00:00.000Z";

const agent = (overrides: {
  annotations?: Record<string, string>;
  spec?: Record<string, unknown>;
}): KubeObject => ({
  apiVersion: "agent-platform.ai/v1",
  kind: "Agent",
  metadata: {
    name: "agent-live",
    uid: "0f8fad5b-d9cb-469f-a165-70867728950e",
    generation: 4,
    creationTimestamp: "2026-10-01T08:00:00Z",
    labels: { "agent-platform.ai/owner": "sub-1" },
    annotations: overrides.annotations ?? {},
  } as KubeObject["metadata"],
  spec: overrides.spec ?? { image: "agent:1" },
  status: {},
});

describe("what a rollback may do", () => {
  const liveInstall = {
    releaseName: "platform",
    namespace: "platform-agents",
    apiServer: "https://api.dev:6443",
  };
  const base = {
    absorbedAt: new Date(AT) as Date | null,
    markerStore: "postgres" as string | null,
    markerAbsorbedAt: AT as string | null,
    install: liveInstall as typeof liveInstall | null,
    liveInstall,
    agentRows: 9,
    liveAgents: 9,
  };

  // TEST_SCENARIO: The dangerous states are named before anything is written. An empty store on a switched cluster is the wrong database; an empty store on a cluster with no switched marker is a finished rollback; a store with no rows and live resources is not restorable; and a database absorbed by another install, or at another time than the marker names, is refused.
  it("refuses the states that lose data and no-ops the finished one", () => {
    const verdict = (overrides: Partial<typeof base>) =>
      rollbackVerdict({ ...base, ...overrides }).action;
    expect(verdict({ absorbedAt: null, agentRows: 0 })).toBe("refuse");
    expect(verdict({ absorbedAt: null, markerStore: null, agentRows: 0 })).toBe(
      "noop",
    );
    expect(verdict({ markerStore: "crd" })).toBe("refuse");
    expect(verdict({ markerStore: null })).toBe("restore");
    expect(verdict({ absorbReport: undefined } as never)).toBe("restore");
    expect(verdict({ agentRows: 0 })).toBe("refuse");
    expect(verdict({ agentRows: 0, liveAgents: 0 })).toBe("restore");
    expect(verdict({ install: null })).toBe("refuse");
    expect(
      verdict({
        install: { ...liveInstall, releaseName: "other" },
      }),
    ).toBe("refuse");
    expect(
      verdict({
        install: { ...liveInstall, apiServer: "https://api.prod:6443" },
      }),
    ).toBe("refuse");
    expect(verdict({ markerAbsorbedAt: "2026-10-23T00:00:00.000Z" })).toBe(
      "refuse",
    );
  });

  // TEST_SCENARIO: The dry run creates nothing, so it must not demand the uid of an Agent it has not created; a real run without one refuses rather than orphaning every child.
  it("re-points only with a uid, and the dry run reports the one it would take", () => {
    expect(rePointAction({ dryRun: true, liveUid: null })).toEqual({
      action: "skip",
    });
    expect(rePointAction({ dryRun: false, liveUid: null })).toEqual({
      action: "throw",
    });
    expect(rePointAction({ dryRun: false, liveUid: "uid-1" })).toEqual({
      action: "repoint",
      uid: "uid-1",
    });
  });

  // TEST_SCENARIO: A budget removed in row mode is deleted from the cluster on rollback, while a resource the absorb never recorded, or one that still has a row, is left alone. The same rule covers Agents and budgets, or a removed override resurrects on the previous release.
  it("removes only absorbed resources whose row is gone", () => {
    const membership = snapshotMembership([
      { kind: "Agent", name: "agent-a", uid: "uid-a" },
      { kind: "Agent", name: "agent-b", uid: "uid-b" },
      { kind: "UserBudget", name: "budget-gone", uid: "uid-budget" },
      { kind: "UserBudget", name: "budget-kept", uid: "uid-kept" },
    ]);
    expect(
      absentAbsorbedResources({
        kind: "Agent",
        live: [
          { name: "agent-a", uid: "uid-a" },
          { name: "agent-b", uid: "uid-b" },
          { name: "agent-out-of-band", uid: "uid-x" },
        ],
        restored: new Set(["agent-b"]),
        membership,
      }),
    ).toEqual(["agent-a"]);
    expect(
      absentAbsorbedResources({
        kind: "UserBudget",
        live: [
          { name: "budget-gone", uid: "uid-budget" },
          { name: "budget-kept", uid: "uid-kept" },
        ],
        restored: new Set(["budget-kept"]),
        membership,
      }),
    ).toEqual(["budget-gone"]);
    expect(
      absentAbsorbedResources({
        kind: "UserBudget",
        live: [{ name: "budget-new", uid: "uid-new" }],
        restored: new Set(),
        membership,
      }),
    ).toEqual([]);
  });
});

describe("the object a rollback writes", () => {
  // TEST_SCENARIO: A grant revoked, a host removed and a flag turned off after the switch come back cleared, not with the value the frozen custom resource still carries. A merge patch would keep them; the replace writes the rows' whole object, and keeps the finalizers and version the cluster owns.
  it("writes cleared fields whole rather than omitting them", () => {
    const spaced = rowsFromResource(
      agent({
        annotations: { "agent-platform.ai/l7-promotion": "gone" },
        spec: { image: "agent:1", l7Hosts: ["gone.example.test"] },
      }),
      DEFAULTS,
      AT,
    );
    const cleared = rowsFromResource(
      agent({ spec: { image: "agent:1" } }),
      DEFAULTS,
      AT,
    );
    const nested = rowsFromResource(
      agent({
        spec: {
          image: "agent:1",
          backend: { type: "vm", vm: { nestedVirtualization: true } },
        },
      }),
      DEFAULTS,
      AT,
    );
    expect(spaced.rows).toBeDefined();
    expect(cleared.rows).toBeDefined();
    const [exported] = exportCrds({
      agents: [cleared.rows!],
      budgets: [],
    });
    const restored = restoreBody({
      resource: exported!,
      live: {
        metadata: {
          name: "agent-live",
          resourceVersion: "42",
          finalizers: ["keep"],
          ownerReferences: [],
        } as KubeObject["metadata"],
      },
      namespace: "platform-agents",
    });
    const spec = restored.body.spec as Record<string, unknown>;
    expect(spec.grantedConnectionIds).toEqual([]);
    expect(spec.l7Hosts).toEqual([]);
    expect(spec.backend).toBeUndefined();
    expect(spec.requireConnectionAddress).toBe(false);
    expect(spec.whispersOff).toBe(false);
    expect(restored.body.metadata).toMatchObject({
      namespace: "platform-agents",
      resourceVersion: "42",
      finalizers: ["keep"],
    });
    expect(
      (restored.body.metadata as Record<string, unknown>).uid,
    ).toBeUndefined();
    const [nestedExport] = exportCrds({ agents: [nested.rows!], budgets: [] });
    const nestedRestored = restoreBody({
      resource: nestedExport!,
      live: null,
      namespace: "platform-agents",
    });
    expect(nestedRestored.body.spec).toMatchObject({
      backend: { type: "vm", vm: { nestedVirtualization: true } },
    });
    expect(restored.status?.conditions).toEqual([]);
    expect(statusBody(restored.status)).toEqual({
      conditions: [],
      observedGeneration: 0,
      agentPodRestarts: 0,
      agentPodRestartReason: null,
    });
  });

  // TEST_SCENARIO: The digest an operator attests is compared whole; a one-character prefix is not the archive.
  it("compares the attested digest exactly", () => {
    expect(attestedDigestMatches("abc123", "ABC123")).toBe(true);
    expect(attestedDigestMatches("abc123", "abc")).toBe(false);
    expect(attestedDigestMatches(null, "abc")).toBe(false);
  });
});

describe("the freeze a rollback observes", () => {
  // TEST_SCENARIO: Only a cluster that shows the frozen value, no replica and no pod, with a Lease nobody renewed, may be restored under; anything else refuses and says why.
  it("refuses anything but a fully frozen cluster", () => {
    const frozen = {
      deployments: [
        {
          name: "platform-apiserver",
          component: "apiserver",
          frozenTemplate: true,
          replicas: 0,
          pods: 0,
          readyPods: 0,
        },
        {
          name: "platform-controller",
          component: "controller",
          frozenTemplate: true,
          replicas: 0,
          pods: 0,
          readyPods: 0,
        },
      ],
      lease: {
        holder: null,
        renewedAt: null,
        durationSeconds: 15,
      },
      now: new Date(AT),
    };
    expect(frozenRefusals(frozen)).toEqual([]);
    expect(
      frozenRefusals({
        ...frozen,
        deployments: [
          { ...frozen.deployments[0]!, frozenTemplate: false },
          frozen.deployments[1]!,
        ],
      }),
    ).toHaveLength(1);
    expect(
      frozenRefusals({
        ...frozen,
        deployments: [
          { ...frozen.deployments[0]!, replicas: 1 },
          frozen.deployments[1]!,
        ],
      })[0],
    ).toMatch(/desired replica/);
    expect(
      frozenRefusals({
        ...frozen,
        deployments: [
          { ...frozen.deployments[0]!, pods: 1, readyPods: 1 },
          frozen.deployments[1]!,
        ],
      })[0],
    ).toMatch(/pod/);
    expect(
      frozenRefusals({
        ...frozen,
        lease: {
          holder: "platform-controller-old",
          renewedAt: new Date(new Date(AT).getTime() - 5_000),
          durationSeconds: 15,
        },
      })[0],
    ).toMatch(/Lease is still held/);
    expect(frozenRefusals({ ...frozen, deployments: [] })).toHaveLength(2);
  });
});

describe("the archive's digest", () => {
  // TEST_SCENARIO: The operator's digest is the store's digest: one ordering, compared in JavaScript rather than in the database's collation, where a hyphen sorts differently.
  it("orders the same way wherever it is read", () => {
    const ordered = orderDocuments([
      { kind: "UserBudget", name: "budget-b" },
      { kind: "Agent", name: "agentc" },
      { kind: "Agent", name: "agent-b" },
    ]);
    expect(ordered.map((one) => one.name)).toEqual([
      "agent-b",
      "agentc",
      "budget-b",
    ]);
    const agents = [
      agent({ spec: { image: "agent:1", l7Hosts: ["a.test"] } }),
      {
        ...agent({ spec: { image: "agent:2" } }),
        metadata: {
          ...agent({ spec: {} }).metadata,
          name: "agent-b",
          uid: "11111111-2222-4333-8444-555555555555",
        },
      } as KubeObject,
    ];
    const snapshot = buildAgentStoreSnapshot({ agents, budgets: [] });
    const fromRows = orderDocuments(
      snapshot.documents.map((doc) => ({
        kind: doc.kind,
        name: doc.name,
        sha256: doc.sha256,
        yaml: doc.yaml,
      })),
    );
    expect(
      sha256Of(Buffer.from(fromRows.map((d) => d.yaml).join("---\n"))),
    ).toBe(snapshot.sha256);
  });
});
