import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import {
  AGENT_STORE_ABSORBED_KEY,
  AGENT_STORE_MARKER_KEY,
  agentStoreMarkerName,
  agentStoreRefusal,
  readAgentStoreMarker,
  verifyAgentStoreWriteFence,
} from "../../modules/agent-store/fence.js";

// TEST_OVERVIEW: The startup fence is what keeps one wrong pairing from serving: a build on the custom resources after the authority switched, or a build on Postgres before the switch absorbed anything. Both crash-loop instead, and both read the one marker the absorb leaves in the cluster.

const ABSORBED = {
  [AGENT_STORE_MARKER_KEY]: "postgres",
  [AGENT_STORE_ABSORBED_KEY]: "2026-10-24T00:00:00Z",
};

describe("agent store fence", () => {
  // TEST_SCENARIO: Every pairing of the two modes against the three marker states, because the ordinary install walks through them in order and must never be refused on the way.
  it("refuses only the two pairings that would serve the wrong store", () => {
    const cases: Array<
      [string, "crd" | "postgres", Record<string, string> | null, boolean]
    > = [
      ["custom resources, no marker", "crd", null, false],
      [
        "custom resources, an explicit crd marker",
        "crd",
        { [AGENT_STORE_MARKER_KEY]: "crd" },
        false,
      ],
      [
        "custom resources, a state this build does not know",
        "crd",
        { [AGENT_STORE_MARKER_KEY]: "frozen" },
        true,
      ],
      [
        "custom resources, switched",
        "crd",
        { [AGENT_STORE_MARKER_KEY]: "postgres" },
        true,
      ],
      ["custom resources, absorbed", "crd", ABSORBED, true],
      ["postgres, no marker", "postgres", null, true],
      [
        "postgres, switched without an absorb stamp",
        "postgres",
        { [AGENT_STORE_MARKER_KEY]: "postgres" },
        true,
      ],
      ["postgres, absorbed", "postgres", ABSORBED, false],
    ];

    for (const [name, mode, marker, refused] of cases) {
      const refusal = agentStoreRefusal(mode, marker);
      expect(refusal === null, name).toBe(!refused);
    }
  });

  // TEST_SCENARIO: Configuration says what an operator wants; the capability says what the binary can do. A rollback that restores images while the chart keeps the switch's values must be refused by the image, so a build with no Postgres reader refuses that mode whatever the marker holds.
  it("refuses the Postgres mode in a build that cannot read it", () => {
    for (const marker of [
      null,
      { [AGENT_STORE_MARKER_KEY]: "postgres" },
      ABSORBED,
    ])
      expect(
        agentStoreRefusal("postgres", marker, {
          readsPostgres: false,
        })?.includes("no Postgres reader"),
      ).toBe(true);
  });

  // TEST_SCENARIO: The release that reads Postgres flip the capability, and then the same pairs decide on the marker alone.
  it("lets a build with a Postgres reader serve only an absorbed store", () => {
    const readsPostgres = { readsPostgres: true };
    expect(agentStoreRefusal("postgres", ABSORBED, readsPostgres)).toBeNull();
    expect(agentStoreRefusal("postgres", null, readsPostgres)).toBeTruthy();
    expect(
      agentStoreRefusal(
        "postgres",
        { [AGENT_STORE_MARKER_KEY]: "postgres" },
        readsPostgres,
      ),
    ).toBeTruthy();
    expect(agentStoreRefusal("crd", ABSORBED, readsPostgres)).toBeTruthy();
  });

  // TEST_SCENARIO: The marker lives in the agent namespace under the name the chart pins the Role to, which falls back to the release's own name off-chart. A read that fails for any reason other than absence must stop the start: a fence that cannot read its fact has not passed, and must say which object it could not read.
  it("reads the marker by name and treats only a 404 as absent", async () => {
    expect(agentStoreMarkerName("platform")).toBe("platform-agent-store");

    const asked: Array<{ namespace: string; name: string }> = [];
    const absent = {
      readNamespacedConfigMap: async (args: {
        namespace: string;
        name: string;
      }) => {
        asked.push(args);
        throw Object.assign(new Error("not found"), { code: 404 });
      },
    } as unknown as k8s.CoreV1Api;
    expect(
      await readAgentStoreMarker(
        absent,
        "platform-agents",
        "platform-agent-store",
      ),
    ).toBeNull();
    expect(asked).toEqual([
      { namespace: "platform-agents", name: "platform-agent-store" },
    ]);

    const present = {
      readNamespacedConfigMap: async () => ({ data: ABSORBED }),
    } as unknown as k8s.CoreV1Api;
    expect(
      await readAgentStoreMarker(present, "platform-agents", "dam-agent-store"),
    ).toEqual(ABSORBED);

    const broken = {
      readNamespacedConfigMap: async () => {
        throw new Error("the API server is unreachable");
      },
    } as unknown as k8s.CoreV1Api;
    await expect(
      readAgentStoreMarker(broken, "platform-agents", "platform-agent-store"),
    ).rejects.toThrow("platform-agents/platform-agent-store");
  });
});

describe("the switch's write fence", () => {
  // TEST_SCENARIO: A leftover aggregate role grants `update` without `create` or `patch`; the proof must see every write verb, or the api-server serves while it can still overwrite a custom resource.
  it("refuses while any write verb is still allowed", async () => {
    const review = (allowed: string[]) => ({
      createSelfSubjectAccessReview: async (input: {
        body: { spec: { resourceAttributes: { verb: string } } };
      }) => ({
        status: {
          allowed: allowed.includes(input.body.spec.resourceAttributes.verb),
        },
      }),
    });
    const client = review([]) as unknown as Parameters<
      typeof verifyAgentStoreWriteFence
    >[0];
    expect(
      await verifyAgentStoreWriteFence(client, "platform-agents"),
    ).toBeNull();
    const updateOnly = review(["update"]) as unknown as Parameters<
      typeof verifyAgentStoreWriteFence
    >[0];
    expect(
      await verifyAgentStoreWriteFence(updateOnly, "platform-agents"),
    ).toMatch(/update agents/);
    const deleteCollection = review([
      "deletecollection",
    ]) as unknown as Parameters<typeof verifyAgentStoreWriteFence>[0];
    expect(
      await verifyAgentStoreWriteFence(deleteCollection, "platform-agents"),
    ).toMatch(/deletecollection agents/);
  });
});
