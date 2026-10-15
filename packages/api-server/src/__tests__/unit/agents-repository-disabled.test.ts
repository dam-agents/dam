// TEST_OVERVIEW: a disabled Agent stays down until its owner enables it. Disabling stamps the stop request, and no wake path clears it while the disabled mark stands: an explicit wake answers "disabled", a schedule poke writes nothing, and a relay's ensureReady fails with a stopped error that says the Agent is disabled. Enabling clears both marks but leaves the Agent asleep until its next use.
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
      metadata: { name: "a1", annotations: {} },
      spec: { name: "a1" },
      status: {
        conditions: [{ type: "Ready", status: "False", reason: "Hibernated" }],
      },
    } as KubeObject,
  ]);
  const repo = createAgentsRepository(client, createLiveAgentStateCache(client));
  const annotations = () => store.get("a1")?.metadata?.annotations ?? {};
  return { repo, annotations };
}

describe("a disabled agent", () => {
  // TEST_SCENARIO: once disabled, an explicit wake and a schedule poke leave the stop request standing, and a relay's ensureReady is refused as disabled.
  it("refuses every wake while the disabled mark stands", async () => {
    const { repo, annotations } = setup();
    expect((await repo.setDisabled("a1", true))?.disabled).toBe(true);
    const stamp = annotations()[STOP];
    expect(stamp).toBeTruthy();

    expect(await repo.wake("a1")).toBe("disabled");
    expect(await repo.wakeIfHibernated("a1")).toBeNull();
    await expect(repo.ensureReady("a1")).rejects.toMatchObject({
      name: "AgentStoppedError",
      disabled: true,
    });
    expect(annotations()[STOP]).toBe(stamp);
  });

  // TEST_SCENARIO: enabling clears both marks with a stale activity clock, so the agent stays asleep; the next wake then goes through.
  it("stays asleep after it is enabled, until its next wake", async () => {
    const { repo, annotations } = setup();
    await repo.setDisabled("a1", true);
    const enabled = await repo.setDisabled("a1", false);
    expect(enabled).toMatchObject({ disabled: false, stopRequested: false });
    expect(annotations()[ACTIVITY]).toBe("1970-01-01T00:00:00Z");

    expect(await repo.wake("a1")).toMatchObject({ disabled: false });
    expect(annotations()[DISABLED]).toBe("");
    expect(annotations()[ACTIVITY]).not.toBe("1970-01-01T00:00:00Z");
  });
});
