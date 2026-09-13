// TEST_OVERVIEW: the conversion an install goes through once, from the resources it kept in the Kubernetes API to the rows that replace them. It runs while the old install is quiesced and there is no second chance to notice a field that silently did not come across — an agent whose credential reference did not survive starts perfectly and fails at its first upstream call — so the mapping is pinned here rather than discovered during a cutover.
import { describe, expect, it } from "vitest";
import {
  agentRecordFromCr,
  budgetRowFromCr,
  rehomeRefs,
  secretRowFromK8s,
} from "../../modules/migration/domain/from-kubernetes.js";

const agentCr = {
  metadata: {
    name: "agent-abc",
    labels: {
      "agent-platform.ai/owner": "sub-1",
      "agent-platform.ai/template": "claude-code",
    },
    annotations: {
      "agent-platform.ai/last-activity": "2026-09-01T00:00:00Z",
      "kubectl.kubernetes.io/last-applied-configuration": '{"spec":{}}',
    },
  },
  spec: {
    image: "quay.io/example/claude-code:1",
    name: "My agent",
    env: [{ name: "FOO", value: "bar" }],
    grantedSecretIds: ["anthropic"],
    grantedConnectionIds: ["conn-1"],
    hibernationTimeout: "30m",
    resources: { limits: { cpu: "2", memory: "4Gi" } },
    imagePullSecretRef: "platform-secret-registry-abc123",
    mounts: [{ path: "/data", persist: true }],
    backend: { type: "vm" },
    storageClass: "fast",
    storageSize: "20Gi",
    nodeSelector: { disk: "ssd" },
    runtimeClassName: "kata",
  },
};

describe("converting an agent custom resource", () => {
  it("carries the definition across", () => {
    const row = agentRecordFromCr(agentCr);
    expect(row).toMatchObject({
      id: "agent-abc",
      owner: "sub-1",
      templateId: "claude-code",
      annotations: {
        "agent-platform.ai/last-activity": "2026-09-01T00:00:00Z",
      },
    });
    expect(row.spec).toMatchObject({
      image: "quay.io/example/claude-code:1",
      name: "My agent",
      env: [{ name: "FOO", value: "bar" }],
      grantedSecretIds: ["anthropic"],
      hibernationTimeout: "30m",
      resources: { limits: { cpu: "2", memory: "4Gi" } },
    });
  });

  // TEST_SCENARIO: `kubectl apply` parks a copy of the whole manifest in an annotation, so anything ever applied that way carries one. It is Kubernetes' bookkeeping, and the agent record is not where it goes.
  it("keeps only the platform's own annotations", () => {
    expect(agentRecordFromCr(agentCr).annotations).toEqual({
      "agent-platform.ai/last-activity": "2026-09-01T00:00:00Z",
    });
  });

  // TEST_SCENARIO: the fields that described how Kubernetes should run a pod. Carrying one across would put a key in the durable spec that nothing reads and every later reader has to explain.
  it("drops what only meant something to Kubernetes", () => {
    const spec = agentRecordFromCr(agentCr).spec as unknown as Record<
      string,
      unknown
    >;
    for (const gone of [
      "mounts",
      "backend",
      "storageClass",
      "storageSize",
      "nodeSelector",
      "runtimeClassName",
      "imagePullSecretRef",
    ]) {
      expect(spec[gone], gone).toBeUndefined();
    }
  });

  // TEST_SCENARIO: the registry credential is the one reference carrying a whole address rather than a name, so it is the one the move has to rewrite.
  it("re-addresses the registry credential to the new store", () => {
    expect(agentRecordFromCr(agentCr).spec.registryAuth).toEqual({
      storeId: "pg",
      path: "sub-1/platform-secret-registry-abc123",
      field: "",
    });
  });

  // TEST_SCENARIO: an agent with no owner label. Guessing an owner would hand someone else's agent to whoever the guess named, so it stops.
  it("refuses an agent it cannot attribute", () => {
    expect(() =>
      agentRecordFromCr({ metadata: { name: "agent-orphan" }, spec: {} }),
    ).toThrow(/owner/);
  });
});

describe("converting a credential", () => {
  const secret = {
    metadata: {
      name: "platform-secret-anthropic-abc123",
      labels: {
        "agent-platform.ai/owner": "sub-1",
        "agent-platform.ai/managed-by": "api-server",
        "agent-platform.ai/secret-type": "connection",
      },
      annotations: { "agent-platform.ai/secret-purpose": "connection" },
    },
    data: { token: Buffer.from("s3cret", "utf8").toString("base64") },
  };

  it("decodes the bytes and re-homes the row under its owner", () => {
    expect(secretRowFromK8s(secret)).toMatchObject({
      storeId: "pg",
      path: "sub-1/platform-secret-anthropic-abc123",
      owner: "sub-1",
      purpose: "connection",
      fields: { token: "s3cret" },
    });
  });

  // TEST_SCENARIO: grants name a secret by its last path segment, so the name has to survive the move unchanged or every agent silently loses every credential it was granted.
  it("keeps the name a grant refers to", () => {
    const row = secretRowFromK8s(secret);
    expect(row.path.split("/").pop()).toBe(secret.metadata.name);
  });

  it("keeps the labels a chain is built from", () => {
    expect(
      (secretRowFromK8s(secret).metadata as { extraLabels: object })
        .extraLabels,
    ).toMatchObject({ "agent-platform.ai/secret-type": "connection" });
  });

  // TEST_SCENARIO: a Secret's data is bytes and this store's is text. Decoding bytes that are not UTF-8 does not throw, it substitutes — so the row would look imported, the credential would work nowhere, and the cluster it came from is gone by the time anyone notices. Nothing the platform mints today is binary, which is why the day one is would go unremarked.
  it("refuses a field that is not text rather than substituting it", () => {
    expect(() =>
      secretRowFromK8s({
        ...secret,
        data: { key: Buffer.from([0x30, 0x82, 0xff, 0xfe]).toString("base64") },
      }),
    ).toThrow(/not text/);
  });
});

describe("converting a budget", () => {
  it("takes the ceiling and its owner", () => {
    expect(
      budgetRowFromCr({ spec: { owner: "sub-1", cpu: "16", memory: "32Gi" } }),
    ).toEqual({ owner: "sub-1", cpu: "16", memory: "32Gi" });
  });
});

describe("re-addressing what a migrated row points at", () => {
  // TEST_SCENARIO: a connection row survives the move untouched — it was always in Postgres — while the secret it names moves to another store under another path. The row still reads as valid, so nothing complains until the agent makes its first upstream call.
  const moved = new Map([
    [
      "platform-secret-connection-anthropic-abc",
      "sub-1/platform-secret-connection-anthropic-abc",
    ],
  ]);

  it("points a connection at where its credential landed", () => {
    const auth = rehomeRefs(
      {
        kind: "header",
        headerName: "x-api-key",
        valueRef: {
          storeId: "k8s",
          path: "platform-secret-connection-anthropic-abc",
          field: "value",
        },
      },
      moved,
    );
    expect(auth).toEqual({
      kind: "header",
      headerName: "x-api-key",
      valueRef: {
        storeId: "pg",
        path: "sub-1/platform-secret-connection-anthropic-abc",
        field: "value",
      },
    });
  });

  it("finds the refs an OAuth connection buries", () => {
    const moved2 = new Map([
      ["access", "sub-1/access"],
      ["refresh", "sub-1/refresh"],
    ]);
    expect(
      rehomeRefs(
        {
          kind: "oauth",
          accessTokenRef: { storeId: "k8s", path: "access", field: "value" },
          nested: [
            {
              refreshTokenRef: {
                storeId: "k8s",
                path: "refresh",
                field: "value",
              },
            },
          ],
        },
        moved2,
      ),
    ).toEqual({
      kind: "oauth",
      accessTokenRef: { storeId: "pg", path: "sub-1/access", field: "value" },
      nested: [
        {
          refreshTokenRef: {
            storeId: "pg",
            path: "sub-1/refresh",
            field: "value",
          },
        },
      ],
    });
  });

  it("leaves a reference to something this migration did not move", () => {
    const auth = {
      valueRef: { storeId: "vault", path: "elsewhere", field: "value" },
    };
    expect(rehomeRefs(auth, moved)).toEqual(auth);
  });
});
