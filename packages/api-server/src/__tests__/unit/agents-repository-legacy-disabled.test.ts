// TEST_OVERVIEW: the mark a removed feature left behind. An Agent that still carries it must come back as an ordinary idle Agent: clearing the mark clears the stop request that stands with it, leaves the Agent asleep, and the next wake goes through.
import { describe, expect, it } from "vitest";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { fakeK8s } from "../helpers/fake-k8s.js";

const STOP = "agent-platform.ai/stop-requested";
const DISABLED = "agent-platform.ai/disabled";
const ACTIVITY = "agent-platform.ai/last-activity";

function setup() {
  const { client, store } = fakeK8s([
    {
      metadata: {
        name: "a1",
        annotations: {
          "agent-platform.ai/reclaimed-at": "2026-10-15T10:00:00Z",
          [DISABLED]: "2026-10-15T10:00:00Z",
          [STOP]: "2026-10-15T10:00:00Z",
        },
      },
      spec: { name: "a1" },
      status: {
        conditions: [{ type: "Ready", status: "False", reason: "Hibernated" }],
      },
    } as KubeObject,
  ]);
  const repo = createAgentsRepository(
    client,
    createLiveAgentStateCache(client),
  );
  const annotations = () => store.get("a1")?.metadata?.annotations ?? {};
  return { repo, annotations };
}

describe("an agent carrying the legacy disabled mark", () => {
  // TEST_SCENARIO: clearing the mark also drops its standing stop request, so the Agent holds nothing down; the activity clock goes stale, so it stays asleep until its next use.
  it("clears the mark and its stop request, and leaves the Agent asleep", async () => {
    const { repo, annotations } = setup();
    expect(await repo.clearLegacyDisabled("a1")).toBe(true);
    expect(annotations()[DISABLED]).toBe("");
    expect(annotations()[STOP]).toBe("");
    expect(annotations()[ACTIVITY]).toBe("1970-01-01T00:00:00Z");
    const agent = await repo.get("a1");
    expect(agent).toMatchObject({ disabled: false, stopRequested: false });
  });

  // TEST_SCENARIO: the next use wakes it, which is what makes a formerly disabled Agent ordinary.
  it("wakes on its next use", async () => {
    const { repo, annotations } = setup();
    await repo.clearLegacyDisabled("a1");
    expect(await repo.wake("a1")).toMatchObject({
      ok: true,
      value: { disabled: false },
    });
    expect(annotations()[ACTIVITY]).not.toBe("1970-01-01T00:00:00Z");
  });

  // TEST_SCENARIO: an Agent that is gone answers false rather than throwing, so one bad id does not stop the boot sweep.
  it("reports no write for an Agent that is gone", async () => {
    const { repo } = setup();
    expect(await repo.clearLegacyDisabled("missing")).toBe(false);
  });
});
