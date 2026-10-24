import { describe, it, expect } from "vitest";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { buildAgentStoreSnapshot } from "../../modules/agent-store/snapshot.js";
import { writeVerifiedBackup } from "../../modules/agent-store/backup.js";
import {
  blockingRefusals,
  mapBudget,
  previewAgentStore,
} from "../../modules/agent-store/preview.js";
import {
  archiveOf,
  encryptToRecipient,
  exportCrds,
  sha256Of,
} from "../../modules/agent-store/exporter.js";
import { rowsFromResource } from "../../modules/agent-store/rows.js";
import * as age from "age-encryption";

// TEST_OVERVIEW: The switch's archive, its backup, the rollback's exporter and
// TEST_OVERVIEW: the findings that stop an absorb. The archive must be complete and
// TEST_OVERVIEW: byte-stable, a backup that cannot be read back must be no backup, and
// TEST_OVERVIEW: the exporter must produce resources that map back to the same rows.

const DEFAULTS = { cpuLimit: "1", memoryLimit: "2Gi" };
const AT = "2026-10-24T12:00:00.000Z";

const agent = (
  name: string,
  overrides: Partial<KubeObject> = {},
): KubeObject => ({
  apiVersion: "agent-platform.ai/v1",
  kind: "Agent",
  metadata: {
    name,
    uid: "0f8fad5b-d9cb-469f-a165-70867728950e",
    generation: 4,
    creationTimestamp: "2026-10-01T08:00:00Z",
    labels: { "agent-platform.ai/owner": "sub-1" },
    annotations: { "agent-platform.ai/roll-rev": "rev-1" },
    ...(overrides.metadata ?? {}),
  } as KubeObject["metadata"],
  spec: {
    image: "agent:1",
    resources: { limits: { cpu: "1500m", memory: "6Gi" } },
    l7Hosts: ["api.example.test"],
    hibernationTimeout: "90m0s",
    ...((overrides.spec ?? {}) as Record<string, unknown>),
  },
  status: { conditions: [] },
});

const budget = (owner: string): KubeObject => ({
  apiVersion: "agent-platform.ai/v1",
  kind: "UserBudget",
  metadata: {
    name: `budget-${owner}`,
    uid: null,
  } as unknown as KubeObject["metadata"],
  spec: { owner, cpu: "2", memory: "4Gi" },
});

describe("the switch's archive", () => {
  // TEST_SCENARIO: The archive holds every resource the API server listed — including one the mapping refuses, which then has no row — in a fixed order, so the same fleet produces the same digest and the object store copy can be verified against it.
  it("is source-complete, ordered and byte-stable", () => {
    const refused = agent("agent-refused", {
      metadata: { uid: undefined } as unknown as KubeObject["metadata"],
    });
    const input = {
      agents: [agent("agent-b"), refused, agent("agent-a")],
      budgets: [budget("sub-2"), budget("sub-1")],
    };
    const first = buildAgentStoreSnapshot(input);
    const second = buildAgentStoreSnapshot({
      agents: [...input.agents].reverse(),
      budgets: [...input.budgets].reverse(),
    });
    expect(first.sha256).toBe(second.sha256);
    expect(first.documents.map((doc) => `${doc.kind}/${doc.name}`)).toEqual([
      "Agent/agent-a",
      "Agent/agent-b",
      "Agent/agent-refused",
      "UserBudget/budget-sub-1",
      "UserBudget/budget-sub-2",
    ]);
    expect(first.yaml).toContain("agent-refused");
    expect(first.yaml).toContain("budget-sub-2");
  });

  // TEST_SCENARIO: A copy that cannot be read back, or that reads back as different bytes, is no backup: the absorb must abort rather than commit with one copy.
  it("treats a copy it cannot verify as no backup", async () => {
    const inner = new Map<string, Buffer>();
    let corrupt = false;
    const store = {
      put: async (key: string, body: Buffer) =>
        void inner.set(key, corrupt ? Buffer.from("tampered\n") : body),
      get: async (key: string) => inner.get(key) ?? null,
    };
    const content = Buffer.from("resources: []\n");
    const digest = sha256Of(content);
    await expect(
      writeVerifiedBackup({
        store,
        keyPrefix: "crd-snapshots/x",
        content,
        expectedSha256: digest,
      }),
    ).resolves.toEqual({
      key: `crd-snapshots/x/${digest}.yaml`,
      sha256: digest,
    });

    corrupt = true;
    await expect(
      writeVerifiedBackup({
        store,
        keyPrefix: "crd-snapshots/x",
        content,
        expectedSha256: digest,
      }),
    ).rejects.toThrow(/read back from/);

    const empty = { put: async () => {}, get: async () => null };
    await expect(
      writeVerifiedBackup({
        store: empty,
        keyPrefix: "crd-snapshots/x",
        content,
        expectedSha256: digest,
      }),
    ).rejects.toThrow(/cannot be read back/);
  });
});

describe("what stops an absorb", () => {
  // TEST_SCENARIO: A record that would stop existing as the platform reads it blocks the switch and is named; the two that would become no row anyway only get reported. A grant that disagrees, or a secret granted by id the store cannot hold, blocks too.
  it("names every finding that would lose a record or a credential", () => {
    const preview = previewAgentStore({
      agents: [
        agent("agent-live"),
        agent("agent-deleting", {
          metadata: { deletionTimestamp: AT } as KubeObject["metadata"],
        }),
        agent("agent-secret", {
          spec: { grantedSecretIds: ["secret-1"] },
        }),
        agent("agent-granted", {
          spec: { grantedConnectionIds: ["only-on-resource"] },
        }),
      ],
      budgets: [
        budget("sub-1"),
        { ...budget("sub-empty"), spec: { owner: "sub-empty" } },
      ],
      grants: [{ agentId: "agent-granted", connectionId: "only-in-database" }],
      defaults: DEFAULTS,
      switchedAt: AT,
    });
    const lines = blockingRefusals(preview);
    expect(lines.join("\n")).toMatch(/agent-secret/);
    expect(lines.join("\n")).toMatch(/agent-granted/);
    expect(lines.join("\n")).not.toMatch(/agent-deleting/);
    expect(
      mapBudget({ ...budget("sub-empty"), spec: { owner: "sub-empty" } })
        .refusal,
    ).toBeDefined();
  });
});

describe("the rollback's exporter", () => {
  // TEST_SCENARIO: Exporting a row and mapping the exported resource back gives the same row: the one field a rollback cannot preserve is the incarnation, which Kubernetes assigns on create, so the resource carries no UID and the rollback re-points the children instead.
  it("round-trips a row through the resource an earlier release reads", () => {
    const original = rowsFromResource(agent("agent-live"), DEFAULTS, AT);
    expect(original.rows).toBeDefined();
    const [exported] = exportCrds({
      agents: [original.rows!],
      budgets: [
        {
          ownerSub: "sub-1",
          cpu: "2",
          memory: null,
          storage: "10Gi",
          setBySub: "operator-1",
          operatorUpdatedAt: new Date(AT),
          createdAt: new Date(AT),
          updatedAt: new Date(AT),
        },
      ],
    });
    expect(exported?.resource.metadata?.uid).toBeUndefined();
    const restored: KubeObject = {
      ...exported!.resource,
      metadata: {
        ...exported!.resource.metadata,
        uid: "11111111-2222-4333-8444-555555555555",
      } as KubeObject["metadata"],
    };
    const back = rowsFromResource(restored, DEFAULTS, AT);
    expect(back.rows?.agent).toMatchObject({
      id: original.rows!.agent.id,
      image: original.rows!.agent.image,
      cpuLimit: original.rows!.agent.cpuLimit,
      memoryLimit: original.rows!.agent.memoryLimit,
      hibernationTimeoutNs: original.rows!.agent.hibernationTimeoutNs,
    });
    expect(back.rows?.hosts).toEqual(original.rows!.hosts);
    expect(back.rows?.grants).toEqual(original.rows!.grants);
    const [exportedBudget] = exportCrds({
      agents: [],
      budgets: [
        {
          ownerSub: "sub-1",
          cpu: "2",
          memory: null,
          storage: "10Gi",
          setBySub: "operator-1",
          operatorUpdatedAt: new Date(AT),
          createdAt: new Date(AT),
          updatedAt: new Date(AT),
        },
      ],
    });
    expect(exportedBudget?.resource.spec).toEqual({
      owner: "sub-1",
      cpu: "2",
      storage: "10Gi",
    });
    expect(archiveOf(exportCrds({ agents: [], budgets: [] }))).toBe("");
  });
});

describe("the operator's archive", () => {
  // TEST_SCENARIO: The archive leaves the platform only as ciphertext to the one public key the install names; nothing here decrypts it, because the identity is the operator's.
  it("encrypts to the recipient and never writes the plaintext", async () => {
    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const plaintext = Buffer.from(
      "kind: Agent\nmetadata:\n  name: agent-live\n",
    );
    const ciphertext = await encryptToRecipient(plaintext, recipient);
    expect(ciphertext.subarray(0, 15).toString()).toContain("age-encryption.");
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(identity);
    expect(await decrypter.decrypt(ciphertext, "text")).toBe(
      plaintext.toString(),
    );
  });
});
